import { evaluateConditions } from './conditions';

describe('evaluateConditions', () => {
  const contact = {
    id: 'c1',
    firstName: 'Priya',
    lastName: 'Sharma',
    email: 'priya@globex.in',
    phone: null,
    score: 65,
    company: { industry: 'Manufacturing' },
  };

  it('matches everything when the tree is empty', () => {
    expect(evaluateConditions({}, contact)).toBe(true);
    expect(evaluateConditions(null, contact)).toBe(true);
  });

  it('compares numbers rather than strings for ordering ops', () => {
    // '9' > '65' as strings, so this is the case that catches a naive compare.
    expect(
      evaluateConditions({ field: 'score', op: 'gt', value: 9 }, contact),
    ).toBe(true);
    expect(
      evaluateConditions({ field: 'score', op: 'lt', value: 9 }, contact),
    ).toBe(false);
  });

  it('handles gte and lte at the boundary', () => {
    expect(
      evaluateConditions({ field: 'score', op: 'gte', value: 65 }, contact),
    ).toBe(true);
    expect(
      evaluateConditions({ field: 'score', op: 'lte', value: 65 }, contact),
    ).toBe(true);
  });

  it('reads nested paths', () => {
    expect(
      evaluateConditions(
        { field: 'company.industry', op: 'eq', value: 'Manufacturing' },
        contact,
      ),
    ).toBe(true);
  });

  it('treats contains case-insensitively', () => {
    expect(
      evaluateConditions(
        { field: 'email', op: 'contains', value: 'GLOBEX' },
        contact,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        { field: 'email', op: 'not_contains', value: 'acme' },
        contact,
      ),
    ).toBe(true);
  });

  it('distinguishes empty from missing correctly', () => {
    expect(
      evaluateConditions({ field: 'phone', op: 'is_empty' }, contact),
    ).toBe(true);
    expect(
      evaluateConditions({ field: 'email', op: 'is_not_empty' }, contact),
    ).toBe(true);
    expect(evaluateConditions({ field: 'nope', op: 'is_empty' }, contact)).toBe(
      true,
    );
  });

  it('supports "in" against a list', () => {
    expect(
      evaluateConditions(
        { field: 'firstName', op: 'in', value: ['Priya', 'Ravi'] },
        contact,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        { field: 'firstName', op: 'in', value: 'Priya' },
        contact,
      ),
    ).toBe(false);
  });

  it('requires every branch of an "all" group', () => {
    expect(
      evaluateConditions(
        {
          all: [
            { field: 'score', op: 'gte', value: 50 },
            { field: 'email', op: 'is_not_empty' },
          ],
        },
        contact,
      ),
    ).toBe(true);

    expect(
      evaluateConditions(
        {
          all: [
            { field: 'score', op: 'gte', value: 50 },
            { field: 'phone', op: 'is_not_empty' },
          ],
        },
        contact,
      ),
    ).toBe(false);
  });

  it('requires one branch of an "any" group', () => {
    expect(
      evaluateConditions(
        {
          any: [
            { field: 'score', op: 'gte', value: 90 },
            { field: 'firstName', op: 'eq', value: 'Priya' },
          ],
        },
        contact,
      ),
    ).toBe(true);

    expect(
      evaluateConditions(
        {
          any: [
            { field: 'score', op: 'gte', value: 90 },
            { field: 'firstName', op: 'eq', value: 'Nobody' },
          ],
        },
        contact,
      ),
    ).toBe(false);
  });

  it('nests groups', () => {
    expect(
      evaluateConditions(
        {
          all: [
            { field: 'score', op: 'gte', value: 50 },
            {
              any: [
                { field: 'company.industry', op: 'eq', value: 'Retail' },
                { field: 'company.industry', op: 'eq', value: 'Manufacturing' },
              ],
            },
          ],
        },
        contact,
      ),
    ).toBe(true);
  });

  it('does not match an ordering op against a non-numeric value', () => {
    expect(
      evaluateConditions({ field: 'firstName', op: 'gt', value: 5 }, contact),
    ).toBe(false);
  });
});
