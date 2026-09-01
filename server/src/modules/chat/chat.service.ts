import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  Channel,
  MessageDirection,
  MessageStatus,
  WorkflowTrigger,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { RoutingService } from '../routing/routing.service';
import { WORKFLOW_EVENT } from '../workflows/workflow-events';
import {
  ChatMessageDto,
  ChatPageViewDto,
  ChatRatingDto,
  StartChatDto,
} from './dto/chat.dto';

/** Visitors idle for longer than this are treated as offline. */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class ChatService {
  private readonly logger = new Logger('ChatService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: RoutingService,
    private readonly events: EventEmitter2,
  ) {}

  private async requireTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, isActive: true },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Workspace not found');
    return tenant;
  }

  private async requireVisitor(tenantId: string, visitorKey: string) {
    const visitor = await this.prisma.chatVisitor.findFirst({
      where: { visitorKey, tenantId },
    });
    if (!visitor) throw new NotFoundException('Chat session not found');
    return visitor;
  }

  /**
   * Starts a widget session, or resumes one when the browser already holds a
   * visitor key. The conversation itself is created on the first message, so a
   * visitor who never types does not clutter the inbox.
   */
  async start(tenantId: string, dto: StartChatDto, userAgent?: string) {
    await this.requireTenant(tenantId);

    if (dto.visitorKey) {
      const existing = await this.prisma.chatVisitor.findFirst({
        where: { visitorKey: dto.visitorKey, tenantId },
      });
      if (existing) {
        const visitor = await this.prisma.chatVisitor.update({
          where: { id: existing.id },
          data: {
            name: dto.name ?? existing.name,
            email: dto.email ?? existing.email,
            currentPage: dto.currentPage ?? existing.currentPage,
            lastSeenAt: new Date(),
          },
        });
        return {
          visitorKey: visitor.visitorKey,
          resumed: true,
          conversationId: visitor.conversationId,
        };
      }
    }

    const visitor = await this.prisma.chatVisitor.create({
      data: {
        tenantId,
        visitorKey: randomUUID(),
        name: dto.name,
        email: dto.email,
        currentPage: dto.currentPage,
        userAgent,
      },
    });

    return {
      visitorKey: visitor.visitorKey,
      resumed: false,
      conversationId: null,
    };
  }

  /** Records a visitor navigating to another page. */
  async pageView(tenantId: string, dto: ChatPageViewDto) {
    const visitor = await this.requireVisitor(tenantId, dto.visitorKey);
    await this.prisma.chatVisitor.update({
      where: { id: visitor.id },
      data: {
        currentPage: dto.currentPage,
        pageViews: { increment: 1 },
        lastSeenAt: new Date(),
      },
    });
    return { ok: true };
  }

  /** Visitor sends a message; the thread is created on first contact. */
  async sendFromVisitor(tenantId: string, dto: ChatMessageDto) {
    const visitor = await this.requireVisitor(tenantId, dto.visitorKey);

    let conversationId = visitor.conversationId;
    if (!conversationId) {
      // Link to a contact when the visitor gave an email we already know.
      const contact = visitor.email
        ? await this.prisma.contact.findFirst({
            where: { tenantId, email: visitor.email.toLowerCase() },
          })
        : null;

      const conversation = await this.prisma.conversation.upsert({
        where: {
          tenantId_channel_externalId: {
            tenantId,
            channel: Channel.LIVE_CHAT,
            externalId: visitor.visitorKey,
          },
        },
        update: {},
        create: {
          tenantId,
          channel: Channel.LIVE_CHAT,
          externalId: visitor.visitorKey,
          contactId: contact?.id,
        },
      });
      conversationId = conversation.id;

      await this.prisma.chatVisitor.update({
        where: { id: visitor.id },
        data: { conversationId },
      });
    }

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId,
        channel: Channel.LIVE_CHAT,
        direction: MessageDirection.INBOUND,
        type: 'text',
        body: dto.text,
        status: MessageStatus.RECEIVED,
        metadata: { page: visitor.currentPage },
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), status: 'open' },
    });
    await this.prisma.chatVisitor.update({
      where: { id: visitor.id },
      data: { lastSeenAt: new Date() },
    });

    await this.routing.autoAssign(
      tenantId,
      conversationId,
      Channel.LIVE_CHAT,
      dto.text,
    );

    this.events.emit(WORKFLOW_EVENT, {
      tenantId,
      trigger: WorkflowTrigger.MESSAGE_RECEIVED,
      channel: Channel.LIVE_CHAT,
      record: {
        body: dto.text,
        externalId: visitor.visitorKey,
        conversationId,
        page: visitor.currentPage,
      },
    });

    return { id: message.id, conversationId, createdAt: message.createdAt };
  }

  /**
   * Messages for the widget to render. Internal notes are filtered out - the
   * visitor must never see the team talking about them.
   */
  async pollForVisitor(tenantId: string, visitorKey: string) {
    const visitor = await this.requireVisitor(tenantId, visitorKey);
    await this.prisma.chatVisitor.update({
      where: { id: visitor.id },
      data: { lastSeenAt: new Date() },
    });

    if (!visitor.conversationId) return { conversationId: null, messages: [] };

    const messages = await this.prisma.message.findMany({
      where: {
        tenantId,
        conversationId: visitor.conversationId,
        isInternal: false,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        direction: true,
        body: true,
        createdAt: true,
      },
    });

    return { conversationId: visitor.conversationId, messages };
  }

  /** Post-chat rating, stored on the conversation. */
  async rate(tenantId: string, dto: ChatRatingDto) {
    const visitor = await this.requireVisitor(tenantId, dto.visitorKey);
    if (!visitor.conversationId) {
      throw new NotFoundException('No chat to rate yet');
    }

    await this.prisma.conversation.update({
      where: { id: visitor.conversationId },
      data: { rating: dto.rating, ratingComment: dto.comment },
    });
    return { ok: true };
  }

  // ── Agent side ───────────────────────────────

  /** Visitors currently on the site, most recently active first. */
  async listVisitors(tenantId: string) {
    const visitors = await this.prisma.chatVisitor.findMany({
      where: { tenantId },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
    });

    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    return visitors.map((v) => ({
      ...v,
      online: v.lastSeenAt.getTime() >= cutoff,
    }));
  }

  /** Chat satisfaction summary for the dashboard. */
  async ratings(tenantId: string) {
    const rated = await this.prisma.conversation.findMany({
      where: { tenantId, channel: Channel.LIVE_CHAT, rating: { not: null } },
      select: { rating: true, ratingComment: true },
    });

    const total = rated.length;
    const average = total
      ? Math.round(
          (rated.reduce((sum, r) => sum + (r.rating ?? 0), 0) / total) * 10,
        ) / 10
      : 0;

    return {
      total,
      average,
      comments: rated
        .filter((r) => r.ratingComment)
        .slice(0, 20)
        .map((r) => ({ rating: r.rating, comment: r.ratingComment })),
    };
  }

  /** The embeddable widget script, served for a specific workspace. */
  widgetScript(tenantId: string, apiBase: string): string {
    return WIDGET_SOURCE.replace('__API_BASE__', apiBase).replace(
      '__TENANT_ID__',
      tenantId,
    );
  }
}

/**
 * Self-contained chat widget. Dropped onto a customer's site with a single
 * script tag; polls for agent replies and keeps its visitor key in
 * localStorage so a refresh resumes the same conversation.
 */
const WIDGET_SOURCE = `(function () {
  var API = '__API_BASE__';
  var TENANT = '__TENANT_ID__';
  var KEY = 'crm_chat_visitor_' + TENANT;
  var visitorKey = localStorage.getItem(KEY) || null;
  var lastCount = 0;
  var open = false;

  var css = document.createElement('style');
  css.textContent =
    '.crmw{position:fixed;bottom:20px;right:20px;z-index:2147483000;font:14px system-ui,sans-serif}' +
    '.crmw-btn{width:56px;height:56px;border-radius:28px;background:#4f46e5;color:#fff;border:0;cursor:pointer;font-size:22px;box-shadow:0 6px 20px rgba(0,0,0,.2)}' +
    '.crmw-box{display:none;flex-direction:column;width:320px;height:420px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,.18)}' +
    '.crmw-box.on{display:flex}' +
    '.crmw-hd{background:#4f46e5;color:#fff;padding:12px 14px;font-weight:600}' +
    '.crmw-ms{flex:1;overflow-y:auto;padding:12px;background:#f8fafc}' +
    '.crmw-m{max-width:80%;margin-bottom:8px;padding:8px 10px;border-radius:12px;line-height:1.35}' +
    '.crmw-in{background:#4f46e5;color:#fff;margin-left:auto}' +
    '.crmw-out{background:#fff;border:1px solid #e2e8f0}' +
    '.crmw-fm{display:flex;border-top:1px solid #e2e8f0}' +
    '.crmw-fm input{flex:1;border:0;padding:12px;outline:none}' +
    '.crmw-fm button{border:0;background:#4f46e5;color:#fff;padding:0 16px;cursor:pointer}';
  document.head.appendChild(css);

  var root = document.createElement('div');
  root.className = 'crmw';
  root.innerHTML =
    '<div class="crmw-box"><div class="crmw-hd">Chat with us</div>' +
    '<div class="crmw-ms"></div>' +
    '<form class="crmw-fm"><input placeholder="Type a message..." autocomplete="off"/><button>Send</button></form></div>' +
    '<button class="crmw-btn" style="margin-top:10px">&#128172;</button>';
  document.body.appendChild(root);

  var box = root.querySelector('.crmw-box');
  var list = root.querySelector('.crmw-ms');
  var form = root.querySelector('.crmw-fm');
  var input = form.querySelector('input');

  function post(path, body) {
    return fetch(API + '/chat/' + TENANT + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function start() {
    return post('/start', {
      visitorKey: visitorKey,
      currentPage: location.pathname
    }).then(function (r) {
      visitorKey = r.visitorKey;
      localStorage.setItem(KEY, visitorKey);
    });
  }

  function render(messages) {
    if (messages.length === lastCount) return;
    lastCount = messages.length;
    list.innerHTML = messages.map(function (m) {
      var cls = m.direction === 'INBOUND' ? 'crmw-in' : 'crmw-out';
      var text = String(m.body == null ? '' : m.body);
      var div = document.createElement('div');
      div.textContent = text;
      return '<div class="crmw-m ' + cls + '">' + div.innerHTML + '</div>';
    }).join('');
    list.scrollTop = list.scrollHeight;
  }

  function poll() {
    if (!visitorKey || !open) return;
    post('/poll', { visitorKey: visitorKey }).then(function (r) {
      render(r.messages || []);
    }).catch(function () {});
  }

  root.querySelector('.crmw-btn').addEventListener('click', function () {
    open = !open;
    box.classList.toggle('on', open);
    if (open) {
      (visitorKey ? Promise.resolve() : start()).then(poll);
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    (visitorKey ? Promise.resolve() : start())
      .then(function () { return post('/message', { visitorKey: visitorKey, text: text }); })
      .then(poll)
      .catch(function () {});
  });

  setInterval(poll, 4000);
})();`;
