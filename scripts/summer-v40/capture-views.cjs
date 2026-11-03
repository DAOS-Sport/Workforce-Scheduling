const CAPTURE_STAGE = `(() => {
  const week = svWeek();
  const text = el => (el ? el.textContent.trim() : null);
  const tips = root => Array.from(root.querySelectorAll('[data-tip]')).map(el => decodeURIComponent(el.dataset.tip));
  const stateOf = (el, prefix) => (Array.from(el.classList).find(c => c.startsWith(prefix)) || '').slice(prefix.length);
  const out = [];
  datesInWeek(week).forEach(d => {
    svState.day = String(d.dayNo);
    const day = { dayNo: svSelectedDayNo(week), label: svSelectedDayLabel(week), venues: {}, timeline: {}, courses: {}, matrix: {} };
    day.coverageBadge = venues.reduce((s, v) => s + svVenueIssues(v, week), 0);
    day.coursesBadge = venues.reduce((s, v) => s + svCourseMiss(v, week), 0);
    venues.forEach(v => {
      const roles = {};
      ['lifeguard', 'frontdesk'].forEach(role => {
        const list = svShifts(v, week, role);
        roles[role] = {
          shifts: list.map(s => ({ name: s.name, a: s.a, b: s.b, employeeId: s.employeeId, lineBound: s.lineBound, raw: s.raw, key: s.key, isPublished: s.isPublished })),
          gaps: svRoleIssues(v, week, role),
          segs: svDutySegs(v).map(seg => svSegCov(list, seg, svRule(v, role))),
        };
      });
      const list = svCourses(v, week);
      day.venues[v.name] = { roles, courses: list.map(c => ({ ...c, state: svCourseStatus(c) })), summary: svCourseSummary(list), summaryText: svCourseSummaryText(svCourseSummary(list)) };
      document.getElementById('venueFilter').value = v.name;
      svState.view = 'timeline';
      renderScheduleStage();
      const st = document.getElementById('svStage');
      day.timeline[v.name] = {
        tips: tips(st),
        rstat: Array.from(st.querySelectorAll('.sv-rstat')).map(text),
        rneed: Array.from(st.querySelectorAll('.sv-rneed')).map(text),
        sub: text(st.querySelector('.sv-sub')),
        tags: Array.from(st.querySelectorAll('.sv-tag')).map(text),
        bars: Array.from(st.querySelectorAll('.sv-bar')).map(b => ({ label: text(b.querySelector('.mono')), hours: text(b.querySelector('.sv-bh')), removable: !!b.querySelector('.sv-barx'), left: b.style.left, width: b.style.width })),
        chips: Array.from(st.querySelectorAll('.sv-cov')).map(c => ({ state: stateOf(c, 'c-'), gap: c.classList.contains('gap'), glyph: text(c.querySelector('.sv-cg')), fill: c.dataset.fillSeg })),
        courseBars: Array.from(st.querySelectorAll('.sv-cbar')).map(c => ({ state: stateOf(c, 'k-'), code: text(c.querySelector('.sv-code')), tail: text(c.querySelector('.sv-miss')) })),
        emptyLane: Array.from(st.querySelectorAll('.sv-emp.sv-mut')).map(text),
      };
      svState.view = 'courses';
      renderScheduleStage();
      day.courses[v.name] = {
        title: text(st.querySelector('.sv-cvhead h3')),
        sums: Array.from(st.querySelectorAll('.sv-sum')).map(el => ({ cls: el.className, text: text(el) })),
        empty: text(st.querySelector('.sv-cv > .sv-mut')),
        rows: Array.from(st.querySelectorAll('.sv-crow')).map(r => ({
          state: stateOf(r, 'k-'),
          progress: r.querySelector('.sv-mini i') ? r.querySelector('.sv-mini i').style.width : null,
          need: text(r.querySelector('.sv-need')),
          chips: Array.from(r.querySelectorAll('.sv-cchip')).map(c => c.firstChild.textContent),
          button: text(r.querySelector('.sv-assignbtn')),
          buttonKey: r.querySelector('.sv-assignbtn').dataset.editCourse,
          pill: text(r.querySelector('.sv-cstat')),
        })),
      };
    });
    document.getElementById('venueFilter').value = venues[0].name;
    ['lifeguard', 'frontdesk'].forEach(role => {
      svState.view = 'matrix';
      svState.matrixRole = role;
      renderScheduleStage();
      const st = document.getElementById('svStage');
      day.matrix[role] = {
        hint: text(st.querySelector('.sv-mxhint')),
        headers: Array.from(st.querySelectorAll('.sv-vstat')).map(text),
        cells: Array.from(st.querySelectorAll('tbody tr')).map(tr =>
          Array.from(tr.querySelectorAll('.sv-cell')).map(c => ({
            state: stateOf(c, 'k-'),
            num: text(c.querySelector('.sv-num')),
            need: text(c.querySelector('.sv-req')),
            flag: text(c.querySelector('.sv-flag')),
            who: Array.from(c.querySelectorAll('.sv-person-chip')).map(p => ({ name: p.firstChild.textContent, removable: !!p.querySelector('.sv-chipx') })),
            fill: c.dataset.fillSeg || null,
            tip: c.dataset.tip ? decodeURIComponent(c.dataset.tip) : null,
          })),
        ),
      };
    });
    out.push(day);
  });
  svState.view = 'timeline';
  svState.day = 'weekday';
  return out;
})()`;

const CAPTURE_PAYROLL = `(() => {
  const text = el => (el ? el.textContent.trim() : null);
  const cells = sel => Array.from(document.querySelectorAll(sel + ' tr')).map(tr => Array.from(tr.children).map(td => td.textContent.replace(/\\s+/g, ' ').trim()));
  const rates = { lifeguard: numberValue('rateLifeguard'), frontdesk: numberValue('rateFrontdesk') };
  const priced = expandedPayrollRows().map(r => {
    const o = { ...r, payCalc: payrollCalculationForRow(r, rates) };
    if (o.roleType === 'course') { o.courseType = classifyCourseType(o); o.courseHours = PV_TYPE_HOURS[o.courseType] || 0; }
    return o;
  });
  const snap = () => {
    renderPayrollReport();
    return {
      kpis: Array.from(document.querySelectorAll('.pv2-kpi')).map(k => [text(k.querySelector('.k-l')), text(k.querySelector('.k-v')), text(k.querySelector('.k-s'))]),
      typeRows: cells('#pv2TypeBody'),
      staffRows: cells('#pv2StaffBody'),
      coachRows: cells('#pv2CoachBody'),
      detailRows: cells('#pv2DetailBody'),
      hint: text(document.getElementById('pvFilterHint')),
      audit: Array.from(document.querySelectorAll('#pv2NameAuditBody tr')).map(tr => ({ cells: Array.from(tr.children).map(td => td.textContent.trim()), alias: tr.querySelector('input') ? tr.querySelector('input').value : null })),
      typeMap: Array.from(document.querySelectorAll('#pv2TypeMapBody tr')).map(tr => ({ cells: Array.from(tr.children).map(td => td.textContent.trim()), selected: tr.querySelector('select') ? tr.querySelector('select').value : null, highlighted: (tr.getAttribute('style') || '').includes('co-soft') })),
      cram: document.getElementById('pvCramList') ? document.getElementById('pvCramList').value : null,
    };
  };
  const filter = document.getElementById('pvCoachFilter');
  filter.value = '';
  const all = snap();
  filter.value = '王偉';
  const exact = snap();
  window.__csv = null;
  copyPayrollCsv();
  const exactCsv = window.__csv;
  filter.value = '王';
  const fuzzy = snap();
  window.__csv = null;
  copyPayrollCsv();
  const fuzzyCsv = window.__csv;
  filter.value = '';
  renderPayrollReport();
  window.__csv = null;
  copyPayrollCsv();
  const allCsv = window.__csv;
  return { configLoaded: pvConfigLoaded, rates, priced, all, exact, fuzzy, csv: { all: allCsv, exact: exactCsv, fuzzy: fuzzyCsv } };
})()`;

const CAPTURE_MOBILE = `(() => {
  const text = el => (el ? el.textContent.trim() : null);
  renderMobileView();
  const cards = id => Array.from(document.querySelectorAll('#' + id + ' .mobile-card')).map(c => ({
    title: text(c.querySelector('h4')),
    items: Array.from(c.querySelectorAll('.mobile-work')).map(w => ({ pill: w.querySelector('.mobile-pill').className.replace('mobile-pill', '').trim(), pillText: text(w.querySelector('.mobile-pill')), title: text(w.querySelector('b')), small: Array.from(w.querySelectorAll('small')).map(text) })),
  }));
  return {
    summary: Array.from(document.querySelectorAll('#mobileSummaryCards .mobile-stat')).map(s => [text(s.querySelector('span')), text(s.querySelector('b'))]),
    issueGroups: Array.from(document.querySelectorAll('#mobileIssueList .issue-group')).map(g => ({ head: Array.from(g.querySelectorAll('.issue-group-head span')).map(text), items: Array.from(g.querySelectorAll('.issue-item')).map(text) })),
    issueEmpty: text(document.querySelector('#mobileIssueList .mobile-empty')),
    days: cards('mobileWorkCards'),
    daysEmpty: text(document.querySelector('#mobileWorkCards .mobile-empty')),
    employees: cards('mobileEmployeeCards'),
    employeesEmpty: text(document.querySelector('#mobileEmployeeCards .mobile-empty')),
  };
})()`;

const CAPTURE_AVAILABILITY = `(() => ({
  staff: readAvailabilityRows(),
  report: Array.from(document.querySelectorAll('#availabilityResult tr')).map(tr => {
    const td = tr.children;
    if (td.length < 5) return { empty: tr.textContent.trim() };
    return {
      name: td[0].textContent,
      day: td[1].textContent,
      time: td[2].textContent,
      busy: Array.from(td[3].querySelectorAll('.result-busy')).map(b => ({ cls: b.className.replace('result-busy', '').trim(), text: b.textContent })),
      busyEmpty: td[3].querySelector('.result-busy') ? null : td[3].textContent,
      open: Array.from(td[4].querySelectorAll('.result-open')).map(o => o.textContent),
    };
  }),
}))()`;

module.exports = { CAPTURE_STAGE, CAPTURE_PAYROLL, CAPTURE_MOBILE, CAPTURE_AVAILABILITY };
