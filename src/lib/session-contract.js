const SESSION_CONTRACT_SCHEMA = 'opencodex/session-contract/v1';

const THREAD_KIND_LABELS_ZH = {
  host_workflow: '宿主工作流',
  child_session: '子会话',
  service_listener: '服务监听线程',
  host_executor: '宿主执行器'
};

const ROLE_LABELS_ZH = {
  cto_supervisor: 'CTO 主线程',
  planner: '排程规划搭子',
  reply: '回复搭子',
  worker: '工程执行搭子',
  telegram_cto_listener: 'Telegram CTO 监听器',
  telegram_listener: 'Telegram 监听器',
  auto_orchestrator: '自动工作流主线程',
  executor: '执行子会话',
  reviewer: '评审子会话'
};

const THREAD_KIND_LABELS_EN = {
  host_workflow: 'host workflow',
  child_session: 'child session',
  service_listener: 'service listener',
  host_executor: 'host executor'
};

export function buildSessionContract({
  layer = '',
  scope = '',
  threadKind = '',
  thread_kind = '',
  role = '',
  supervisorSessionId = '',
  supervisor_session_id = ''
} = {}) {
  const normalizedLayer = asTrimmedString(layer);
  const normalizedScope = asTrimmedString(scope);
  const normalizedThreadKind = asTrimmedString(threadKind || thread_kind);
  const normalizedRole = asTrimmedString(role);
  const normalizedSupervisorSessionId = asTrimmedString(supervisorSessionId || supervisor_session_id);

  if (!normalizedThreadKind || !normalizedRole) {
    return null;
  }

  return {
    schema: SESSION_CONTRACT_SCHEMA,
    layer: normalizedLayer,
    scope: normalizedScope,
    thread_kind: normalizedThreadKind,
    role: normalizedRole,
    supervisor_session_id: normalizedSupervisorSessionId
  };
}

export function buildSessionContractFromEnv(env = process.env) {
  return readSessionContractFromEnv(env);
}

export function buildSessionContractEnv({
  layer = '',
  scope = '',
  threadKind = '',
  thread_kind = '',
  role = '',
  supervisorSessionId = '',
  supervisor_session_id = ''
} = {}) {
  const contract = buildSessionContract({
    layer,
    scope,
    threadKind,
    thread_kind,
    role,
    supervisorSessionId,
    supervisor_session_id
  });
  if (!contract) {
    return {};
  }

  return {
    OPENCODEX_SESSION_LAYER: contract.layer,
    OPENCODEX_SESSION_SCOPE: contract.scope,
    OPENCODEX_SESSION_THREAD_KIND: contract.thread_kind,
    OPENCODEX_SESSION_ROLE: contract.role,
    OPENCODEX_SESSION_SUPERVISOR_ID: contract.supervisor_session_id
  };
}

export function readSessionContractFromEnv(env = process.env) {
  return buildSessionContract({
    layer: env.OPENCODEX_SESSION_LAYER,
    scope: env.OPENCODEX_SESSION_SCOPE,
    threadKind: env.OPENCODEX_SESSION_THREAD_KIND,
    role: env.OPENCODEX_SESSION_ROLE,
    supervisorSessionId: env.OPENCODEX_SESSION_SUPERVISOR_ID
  });
}

export function applySessionContract(session, contract) {
  if (!session || typeof session !== 'object') {
    return session;
  }

  const normalizedContract = normalizeSessionContract(contract);
  if (normalizedContract) {
    session.session_contract = normalizedContract;
  }

  return session;
}

export function describeSessionContract(value, fallback = {}) {
  const directContract = normalizeSessionContract(value);
  const sessionContract = normalizeSessionContract(value?.session_contract || value?.contract);
  const fallbackContract = buildSessionContract(fallback);
  const contract = sessionContract || directContract || fallbackContract;

  return {
    contract,
    layer: contract?.layer || '',
    thread_kind: contract?.thread_kind || '',
    thread_kind_zh: contract?.thread_kind ? (THREAD_KIND_LABELS_ZH[contract.thread_kind] || '') : '',
    role: contract?.role || '',
    role_zh: contract?.role ? (ROLE_LABELS_ZH[contract.role] || '') : '',
    scope: contract?.scope || '',
    supervisor_session_id: contract?.supervisor_session_id || ''
  };
}

export function getThreadKindLabelZh(threadKind = '') {
  return THREAD_KIND_LABELS_ZH[asTrimmedString(threadKind)] || '';
}

export function getRoleLabelZh(role = '') {
  return ROLE_LABELS_ZH[asTrimmedString(role)] || '';
}

export function buildSessionContractSnapshot(value, fallback = {}) {
  const description = describeSessionContract(value, fallback);
  if (!description.contract) {
    return null;
  }

  return {
    schema: description.contract.schema,
    layer: description.layer,
    scope: description.scope,
    thread_kind: description.thread_kind,
    thread_kind_zh: description.thread_kind_zh,
    role: description.role,
    role_zh: description.role_zh,
    supervisor_session_id: description.supervisor_session_id
  };
}

export function inferSessionContract(session, fallback = null) {
  const explicit = normalizeSessionContract(session?.session_contract || session?.contract || session);
  if (explicit) {
    return explicit;
  }

  const normalizedFallback = normalizeSessionContract(fallback);
  if (normalizedFallback) {
    return normalizedFallback;
  }

  if (!session || typeof session !== 'object') {
    return null;
  }

  if (session.command === 'cto') {
    return buildSessionContract({
      layer: 'host',
      thread_kind: 'host_workflow',
      role: 'cto_supervisor',
      scope: 'telegram_cto',
      supervisor_session_id: session.parent_session_id || ''
    });
  }

  if (session.command === 'auto') {
    return buildSessionContract({
      layer: 'host',
      thread_kind: 'host_workflow',
      role: 'auto_orchestrator',
      scope: 'auto',
      supervisor_session_id: session.parent_session_id || ''
    });
  }

  if (session.command === 'im' && session.input?.arguments?.provider === 'telegram') {
    return buildSessionContract({
      layer: 'host',
      thread_kind: 'service_listener',
      role: session.input?.arguments?.delegate_mode === 'cto' ? 'telegram_cto_listener' : 'telegram_listener',
      scope: session.input?.arguments?.delegate_mode === 'cto' ? 'telegram_cto' : 'telegram'
    });
  }

  return null;
}

export function isTruthyEnv(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && !['0', 'false', 'off', 'no'].includes(normalized);
}

export function formatSessionThreadKindLabel(threadKind = '') {
  const normalized = asTrimmedString(threadKind);
  return THREAD_KIND_LABELS_EN[normalized] || normalized;
}

function normalizeSessionContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  if (value.schema && value.schema !== SESSION_CONTRACT_SCHEMA) {
    return null;
  }

  return buildSessionContract({
    layer: value.layer,
    scope: value.scope,
    threadKind: value.thread_kind,
    role: value.role,
    supervisorSessionId: value.supervisor_session_id
  });
}

function asTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
