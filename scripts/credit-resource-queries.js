'use strict';

function formatLocalDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildCreditResourceBody(now = new Date()) {
  const end = new Date(now.getTime());
  end.setFullYear(end.getFullYear() + 101);
  return {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: 'p_tcaca',
    Status: [0, 3],
    PackageEndTimeRangeBegin: formatLocalDateTime(now),
    PackageEndTimeRangeEnd: formatLocalDateTime(end),
  };
}

module.exports = { buildCreditResourceBody };
