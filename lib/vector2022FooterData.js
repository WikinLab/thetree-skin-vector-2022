function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseTheTreeEditTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    // the tree edit timestamps are represented as Unix seconds.
    const seconds = Number(raw);
    if (!Number.isFinite(seconds)) return null;
    const parsed = new Date(seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

const FOOTER_TIME_ZONE = 'Asia/Seoul';

function getKoreanDateParts(date) {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: FOOTER_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute
  };
}

export function normalizeVector2022Timestamp(value) {
  const parsed = parseTheTreeEditTimestamp(value);
  if (!parsed) return null;

  return {
    iso: parsed.toISOString(),
    text: (() => {
      const parts = getKoreanDateParts(parsed);
      return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.hour}:${parts.minute}`;
    })()
  };
}

export function makeLocalDateHtml(value) {
  const normalized = normalizeVector2022Timestamp(value);
  if (!normalized) {
    return String(value || '') ? `<time>${escapeHtml(value)}</time>` : '';
  }
  return `<time datetime="${escapeHtml(normalized.iso)}">${escapeHtml(normalized.text)}</time>`;
}

export function makeFooterInfoData(pageState = {}, pageContract = {}) {
  const pageData = pageState.data || {};
  if (!pageContract.showLastModifiedFooter) return null;

  const localDate = makeLocalDateHtml(pageData.date);
  const items = [
    {
      id: 'footer-info-lastmod',
      html: pageData.rev
        ? `이 리비전은 ${localDate}에 편집되었습니다.`
        : `이 문서는 ${localDate}에 마지막으로 편집되었습니다.`
    }
  ];

  if (pageData.copyright_text) {
    items.push({ id: 'footer-info-copyright', html: pageData.copyright_text });
  }

  return {
    id: 'footer-info',
    className: null,
    'array-items': items
  };
}
