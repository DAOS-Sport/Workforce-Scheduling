const CAPTURE_CORE = `(() => {
  const tone = el => el.classList.contains('warn') ? 'warn' : el.classList.contains('ok') ? 'ok' : 'none';
  const status = cell => {
    const s = cell.querySelector('.cell-status');
    return { tone: tone(cell), text: s ? s.textContent : '', conflict: !!(s && s.classList.contains('conflict-strong')) };
  };
  const courseCells = Array.from(document.querySelectorAll('.course-validate')).map(cell => {
    const box = cell.querySelector('.editbox');
    return { key: box.dataset.key, ...status(cell) };
  });
  const dutyCells = Array.from(document.querySelectorAll('.duty-grid-cell')).map(cell => {
    const box = cell.querySelector('.duty-grid-entry');
    return { key: box.dataset.key, ...status(cell) };
  });
  const rows = Array.from(document.querySelectorAll('tr[data-course-row]')).map(tr => {
    const en = tr.querySelector('.enroll-count');
    const nd = tr.querySelector('.need-count');
    return {
      venue: tr.dataset.venueName,
      rowId: tr.dataset.courseRow,
      zeroEnroll: tr.classList.contains('zero-enroll'),
      forceOpen: tr.classList.contains('force-open'),
      closed: tr.classList.contains('course-closed'),
      hasIssue: tr.classList.contains('has-issue'),
      enrollText: en ? en.innerText : null,
      enrollClass: en ? ['api', 'empty', 'manual', 'loading'].filter(c => en.classList.contains(c)).join(' ') : null,
      enrollTitle: en ? en.getAttribute('title') : null,
      neededText: nd ? nd.innerText : null,
      placeholders: Array.from(tr.querySelectorAll('.course-validate .editbox')).map(b => b.getAttribute('data-placeholder')),
    };
  });
  const dataKeys = Array.from(document.querySelectorAll('#venueList [data-key]')).map(el => el.dataset.key);
  const payload = collectSchedulePayload();
  return {
    shifts: collectShiftRowsForPortal(),
    assignments: collectNormalizedAssignments(),
    rawEntries: payload.rawEntries,
    courseCells,
    dutyCells,
    rows,
    issues: collectCurrentIssues(),
    issueRowsWithIssue: Array.from(document.querySelectorAll('tr.has-issue')).length,
    dataKeys,
  };
})()`;

module.exports = { CAPTURE_CORE };
