import { loadSupportConfig } from './config.js';
import { createSupportAdapters } from './adapters.js';
import { createSupportService } from './service.js';
import { loadSupportState, saveSupportState } from './state-store.js';

export async function createSupportRuntime({ cwd, onTelegramOutbound, onXianyuOutbound }) {
  const { config, configPath } = loadSupportConfig(cwd);
  const { state, statePath } = await loadSupportState(cwd, config.statePath);

  const adapters = createSupportAdapters({
    onTelegramOutbound,
    onXianyuOutbound
  });

  const service = createSupportService({
    config,
    state,
    adapters,
    saveState: async (nextState) => {
      await saveSupportState(statePath, nextState);
    }
  });

  return {
    enabled: config.enabled,
    config,
    configPath,
    statePath,
    service,
    async handleTelegramInbound(message) {
      return service.handleInbound({
        channel: 'telegram_group',
        text: message?.text || '',
        chatId: String(message?.chat_id || ''),
        senderId: String(message?.sender_id || ''),
        userId: String(message?.sender_id || ''),
        threadKey: `tg:${String(message?.chat_id || '')}`
      });
    },
    async handleXianyuInbound(payload) {
      return service.handleInbound({
        channel: 'xianyu_personal',
        text: payload?.text || '',
        userId: String(payload?.user_id || ''),
        senderId: String(payload?.sender_id || payload?.user_id || ''),
        threadKey: `xy:${String(payload?.user_id || '')}`
      });
    }
  };
}
