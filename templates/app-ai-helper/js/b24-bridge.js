(function () {
  const inIframe = (() => { try { return window.self !== window.top; } catch (_) { return true; } })();
  const hasBX = typeof window.BX24 !== 'undefined';

  window.B24 = {
    inIframe,
    hasBX,
    placement: null,
    callerInfo: null,
    ready: false,
    listeners: [],

    onReady(fn) {
      if (this.ready) fn();
      else this.listeners.push(fn);
    },

    _emit() {
      this.ready = true;
      this.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
      this.listeners = [];
    },

    callMethod(method, params = {}) {
      return new Promise((resolve, reject) => {
        if (!hasBX) return reject(new Error('BX24 SDK not loaded'));
        BX24.callMethod(method, params, (result) => {
          if (result.error()) reject(result.error());
          else resolve(result.data());
        });
      });
    },

    async writeCallComment(text) {
      if (!hasBX || !this.placement) return false;
      const opts = this.placement.options || {};
      const callId = opts.CALL_ID || opts.callId;
      if (!callId) return false;
      try {
        await this.callMethod('telephony.externalcall.update', {
          CALL_ID: callId,
          USER_COMMENT: text,
        });
        return true;
      } catch (e) {
        console.warn('Failed to write call comment', e);
        return false;
      }
    },

    async writeDealComment(dealId, text) {
      if (!hasBX || !dealId) return false;
      try {
        await this.callMethod('crm.timeline.comment.add', {
          fields: { ENTITY_ID: dealId, ENTITY_TYPE: 'deal', COMMENT: text },
        });
        return true;
      } catch (e) {
        console.warn('Failed to write deal comment', e);
        return false;
      }
    },
  };

  if (!hasBX) {
    window.B24._emit();
    return;
  }

  BX24.init(async function () {
    try {
      const placement = BX24.placement.info();
      window.B24.placement = placement;

      if (placement && (placement.placement === 'CALL_CARD' || placement.placement === 'CRM_DEAL_DETAIL_TAB')) {
        const opts = placement.options || {};
        const phone = opts.PHONE || opts.phoneNumber;
        const entityType = (opts.ENTITY_TYPE_ID || opts.entityTypeId || '').toString().toUpperCase();
        const entityId = opts.ENTITY_ID || opts.entityId || opts.ID;

        let info = { phone, entityType, entityId };

        if (entityId && entityType === 'DEAL') {
          try {
            const deal = await window.B24.callMethod('crm.deal.get', { id: entityId });
            info.deal = { id: deal.ID, title: deal.TITLE, stage: deal.STAGE_ID, opportunity: deal.OPPORTUNITY };
          } catch (_) {}
        }
        if (entityId && entityType === 'CONTACT') {
          try {
            const contact = await window.B24.callMethod('crm.contact.get', { id: entityId });
            info.contact = { id: contact.ID, name: `${contact.NAME || ''} ${contact.LAST_NAME || ''}`.trim(), company: contact.COMPANY_TITLE };
          } catch (_) {}
        }
        window.B24.callerInfo = info;
      }

      try { BX24.fitWindow(); } catch (_) {}
    } catch (e) {
      console.warn('B24 init error', e);
    } finally {
      window.B24._emit();
    }
  });

  setTimeout(() => { if (!window.B24.ready) window.B24._emit(); }, 2500);
})();
