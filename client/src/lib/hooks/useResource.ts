'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Paginated } from '@/types';

/**
 * Generic CRUD hooks for a paginated REST resource at `/{resource}`.
 * Queries are cached by the global QueryClient (staleTime 60s) so revisiting
 * a page renders instantly from cache while refreshing in the background.
 */
export function useList<T>(resource: string, params?: Record<string, unknown>) {
  return useQuery({
    queryKey: [resource, 'list', params ?? {}],
    queryFn: async () => {
      const { data } = await api.get<Paginated<T>>(`/${resource}`, { params });
      return data;
    },
  });
}

export function useCreate<T, B = Partial<T>>(resource: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: B) => {
      const { data } = await api.post<T>(`/${resource}`, body);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [resource] });
    },
  });
}

export function useUpdate<T, B = Partial<T>>(resource: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: B }) => {
      const { data } = await api.patch<T>(`/${resource}/${id}`, body);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [resource] });
    },
  });
}

export function useRemove(resource: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/${resource}/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [resource] });
    },
  });
}
