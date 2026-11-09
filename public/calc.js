/**
 * Grade math, shared by the browser (window.GradeCalc) and the unit tests (require).
 * No DOM access in here, so it stays easy to test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GradeCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const EPS = 1e-9;
  const round2 = (n) => Math.round(n * 100) / 100;
  const safeNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  /** 87.5 -> "87.5", 90 -> "90" */
  const fmt = (n) => String(round2(n));

  /**
   * @param {Array<{name:string, weight:number, score:number|null, maxScore:number}>} components
   * @param {number} target  desired final grade in percent (0-100)
   */
  function summarize(components, target) {
    let totalWeight = 0;
    let gradedWeight = 0;
    let earned = 0; // weighted points earned so far (out of totalWeight)
    const ungraded = [];

    for (const c of components) {
      const w = Math.max(0, safeNum(c.weight));
      const max = safeNum(c.maxScore);
      const hasScore = c.score !== null && c.score !== undefined && Number.isFinite(c.score);
      totalWeight += w;
      if (hasScore && max > 0) {
        gradedWeight += w;
        earned += w * (c.score / max);
      } else {
        ungraded.push(c);
      }
    }

    const remainingWeight = Math.max(0, totalWeight - gradedWeight);
    const current = gradedWeight > EPS ? (earned / gradedWeight) * 100 : null;
    const secured = totalWeight > EPS ? (earned / totalWeight) * 100 : null;
    const bestPossible = totalWeight > EPS ? ((earned + remainingWeight) / totalWeight) * 100 : null;

    let required = null;
    let status;
    if (totalWeight <= EPS) {
      status = 'empty';
    } else if (remainingWeight <= EPS) {
      status = 'complete';
    } else {
      required = (((target / 100) * totalWeight - earned) / remainingWeight) * 100;
      if (required <= EPS) status = 'secured';
      else if (required > 100 + EPS) status = 'unreachable';
      else status = 'needed';
    }

    return {
      totalWeight,
      gradedWeight,
      remainingWeight,
      current, // average of the work graded so far
      secured, // what you've locked in toward the final grade
      bestPossible, // if you ace everything left
      required, // average % needed on remaining work to hit the target
      status, // empty | complete | secured | needed | unreachable
      ungraded,
      finalGrade: status === 'complete' ? secured : null,
    };
  }

  // --- grade scales (percent -> letter / GPA) ---------------------------------

  const US_SCALE = [
    [93, 'A', 4.0], [90, 'A-', 3.7], [87, 'B+', 3.3], [83, 'B', 3.0],
    [80, 'B-', 2.7], [77, 'C+', 2.3], [73, 'C', 2.0], [70, 'C-', 1.7],
    [67, 'D+', 1.3], [60, 'D', 1.0], [0, 'F', 0.0],
  ];

  // A common 1.0-5.0 scale. Schools differ, so treat this as an example you can edit.
  const PH_SCALE = [
    [97, 1.0], [94, 1.25], [91, 1.5], [88, 1.75], [85, 2.0],
    [82, 2.25], [79, 2.5], [76, 2.75], [75, 3.0], [0, 5.0],
  ];

  function toUS(pct) {
    const p = round2(pct);
    const row = US_SCALE.find(([min]) => p >= min) || US_SCALE[US_SCALE.length - 1];
    return { letter: row[1], gpa: row[2] };
  }

  function toPH(pct) {
    const p = round2(pct);
    const row = PH_SCALE.find(([min]) => p >= min) || PH_SCALE[PH_SCALE.length - 1];
    return row[1];
  }

  /** scale: 'percent' | 'us' | 'ph' */
  function formatGrade(pct, scale) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
    if (scale === 'us') {
      const g = toUS(pct);
      return `${g.letter} (${g.gpa.toFixed(1)})`;
    }
    if (scale === 'ph') return toPH(pct).toFixed(2);
    return `${fmt(pct)}%`;
  }

  /**
   * Semester overview across subjects, weighted by credit units.
   * Each subject counts with its current grade (the average of the work graded so far).
   * Subjects with nothing graded yet, or without valid units, are skipped and returned in `skipped`.
   */
  function semesterSummary(subjects) {
    let units = 0;
    let pctSum = 0;
    let usSum = 0;
    let phSum = 0;
    let counted = 0;
    const skipped = [];

    for (const s of subjects) {
      const u = typeof s.units === 'number' && Number.isFinite(s.units) && s.units > 0 ? s.units : 0;
      const r = summarize(s.components || [], s.target);
      if (r.current === null || u === 0) {
        skipped.push(s);
        continue;
      }
      units += u;
      pctSum += r.current * u;
      usSum += toUS(r.current).gpa * u;
      phSum += toPH(r.current) * u;
      counted++;
    }

    if (units === 0) return { counted: 0, units: 0, percent: null, gpaUS: null, gpaPH: null, skipped };
    return { counted, units, percent: pctSum / units, gpaUS: usSum / units, gpaPH: phSum / units, skipped };
  }

  return { summarize, semesterSummary, toUS, toPH, formatGrade, fmt };
});
