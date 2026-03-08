export function createDefaultRunSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'result', 'status', 'highlights', 'next_steps'],
    properties: {
      title: { type: 'string' },
      result: { type: 'string' },
      status: {
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed', 'cancelled', 'partial']
      },
      highlights: {
        type: 'array',
        items: { type: 'string' }
      },
      next_steps: {
        type: 'array',
        items: { type: 'string' }
      },
      risks: {
        type: 'array',
        items: { type: 'string' }
      },
      validation: {
        type: 'array',
        items: { type: 'string' }
      },
      changed_files: {
        type: 'array',
        items: { type: 'string' }
      },
      findings: {
        type: 'array',
        items: { type: 'string' }
      }
    }
  };
}

export function normalizeSummary(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      title: fallback.title || 'Command completed',
      result: fallback.result || 'The command finished without a structured summary.',
      status: fallback.status || 'completed',
      highlights: fallback.highlights || [],
      next_steps: fallback.next_steps || []
    };
  }

  return {
    title: asString(value.title, fallback.title || 'Command completed'),
    result: asString(value.result, fallback.result || 'The command completed.'),
    status: asString(value.status, fallback.status || 'completed'),
    highlights: asStringList(value.highlights),
    next_steps: asStringList(value.next_steps),
    risks: asOptionalStringList(value.risks),
    validation: asOptionalStringList(value.validation),
    changed_files: asOptionalStringList(value.changed_files),
    findings: asOptionalStringList(value.findings)
  };
}

export function renderHumanSummary(summary) {
  const lines = [`${summary.title}`, '', summary.result];

  if (summary.highlights?.length) {
    lines.push('', 'Highlights:');
    for (const item of summary.highlights) {
      lines.push(`- ${item}`);
    }
  }

  if (summary.next_steps?.length) {
    lines.push('', 'Next steps:');
    for (const item of summary.next_steps) {
      lines.push(`- ${item}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function asString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === 'string' && item.trim());
}

function asOptionalStringList(value) {
  const list = asStringList(value);
  return list.length ? list : undefined;
}
