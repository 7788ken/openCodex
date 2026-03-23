export function createSupportAdapters({ onTelegramOutbound, onXianyuOutbound } = {}) {
  return {
    telegram_group: {
      channel: 'telegram_group',
      async send(context, message) {
        if (typeof onTelegramOutbound === 'function') {
          await onTelegramOutbound(context, message);
        }
      }
    },
    xianyu_personal: {
      channel: 'xianyu_personal',
      async send(context, message) {
        if (typeof onXianyuOutbound === 'function') {
          await onXianyuOutbound(context, message);
        }
      }
    }
  };
}
