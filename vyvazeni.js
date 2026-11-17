"use strict";

const Vyvazeni = (() => {
  const maxSearchSize = 36;
  const maxSearchStates = 30000;
  const maxSwapSize = 256;
  const maxSwapChecks = 15000;

  function improveBySwaps(groups, costs) {
    let checks = 0;
    while (checks < maxSwapChecks) {
      let best;
      let bestDelta = 0n;
      for (let i = 0; i < groups.length && checks < maxSwapChecks; i++) {
        const left = groups[i];
        for (let j = i + 1; j < groups.length && checks < maxSwapChecks; j++) {
          const right = groups[j];
          if (left.members.length === 1 && right.members.length === 1) continue;
          const current = costs[i](left.sum) + costs[j](right.sum);
          for (const [a, first] of left.members.entries()) {
            for (const [b, second] of right.members.entries()) {
              if (checks++ >= maxSwapChecks) break;
              const diff = second.points - first.points;
              if (!diff) continue;
              const delta = costs[i](left.sum + diff) + costs[j](right.sum - diff) - current;
              if (delta < bestDelta) {
                bestDelta = delta;
                best = { left, right, a, b, diff };
              }
            }
            if (checks >= maxSwapChecks) break;
          }
        }
      }
      if (!best) return;
      const { left, right, a, b, diff } = best;
      [left.members[a], right.members[b]] = [right.members[b], left.members[a]];
      left.sum += diff;
      right.sum -= diff;
    }
  }

  function search(groups, order, lowerCosts, initial) {
    const prefix = [0];
    for (const person of order) prefix.push(prefix.at(-1) + person.points);
    const slots = groups.map(group => ({ capacity: group.members.length, members: [], sum: 0 }));
    const n = order.length;
    let states = 0;
    let truncated = false;
    let best = initial;

    function visit(index) {
      if (best === 0n || truncated) return;
      if (states === maxSearchStates) {
        truncated = true;
        return;
      }
      states++;
      let bound = 0n;
      for (const [i, slot] of slots.entries()) {
        const need = slot.capacity - slot.members.length;
        // Relax the partition: every group may use the same remaining pupils.
        const low = slot.sum + prefix[n] - prefix[n - need];
        const high = slot.sum + prefix[index + need] - prefix[index];
        bound += lowerCosts[i](low, high);
        if (bound >= best) return;
      }
      if (index === n) {
        best = bound;
        for (const [i, slot] of slots.entries()) {
          groups[i].sum = slot.sum;
          groups[i].members = slot.members.slice();
        }
        return;
      }

      const person = order[index];
      const seen = new Set();
      for (const slot of slots) {
        if (slot.members.length === slot.capacity) continue;
        const key = `${slot.capacity}/${slot.members.length}/${slot.sum}`;
        if (seen.has(key)) continue;
        seen.add(key);
        slot.members.push(person);
        slot.sum += person.points;
        visit(index + 1);
        slot.sum -= person.points;
        slot.members.pop();
        if (truncated || best === 0n) break;
      }
    }

    visit(0);
    return { score: best, optimal: !truncated || best === 0n, states };
  }

  function solveTwoGroups(groups, order, total, costs, initial) {
    const size = groups[0].members.length;
    const n = order.length;
    // Bit s in row j means that j pupils can have a combined score of s.
    const history = [[1n, ...Array(size).fill(0n)]];
    for (const person of order) {
      const previous = history.at(-1);
      const shift = BigInt(person.points);
      history.push(previous.map((sums, j) => j ? sums | (previous[j - 1] << shift) : sums));
    }

    const reachable = history[n][size];
    const target = size * total;
    const floor = Math.floor(target / n);
    const ceil = Math.ceil(target / n);
    const below = reachable & ((1n << BigInt(floor + 1)) - 1n);
    const above = reachable >> BigInt(ceil);
    const closestBelow = below ? below.toString(2).length - 1 : -Infinity;
    const closestAbove = above ? ceil + (above & -above).toString(2).length - 1 : Infinity;
    const bestSum = target - n * closestBelow <= n * closestAbove - target ? closestBelow : closestAbove;
    const score = costs[0](bestSum) + costs[1](total - bestSum);
    if (score < initial) {
      const selected = new Set();
      let remaining = size;
      let sum = bestSum;
      for (let i = n - 1; remaining > 0; i--) {
        const canSkip = (history[i][remaining] >> BigInt(sum)) & 1n;
        if (canSkip) continue;
        selected.add(order[i]);
        remaining--;
        sum -= order[i].points;
      }
      groups[0].members = order.filter(person => selected.has(person));
      groups[1].members = order.filter(person => !selected.has(person));
      groups[0].sum = bestSum;
      groups[1].sum = total - bestSum;
    }
    return { score, optimal: true, states: 0 };
  }

  function roundedRoot(numerator, denominator) {
    // The answer is in hundredths. Compare the square against (middle + 1/2)^2.
    let low = 0;
    let high = 10000;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (4n * numerator >= BigInt(2 * middle + 1) ** 2n * denominator) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function optimize(groups, order, runSearch) {
    const n = BigInt(order.length);
    const total = order.reduce((sum, person) => sum + person.points, 0);
    const groupSizes = [...new Set(groups.map(group => group.members.length))];
    const scale = groupSizes.reduce((product, size) => product * BigInt(size), 1n);
    const terms = groups.map(group => {
      const size = BigInt(group.members.length);
      const target = size * BigInt(total);
      const weight = scale / size;
      return {
        cost(sum) {
          const delta = n * BigInt(sum) - target;
          return weight * delta ** 2n;
        },
        lowerCost(low, high) {
          const below = n * BigInt(high) - target;
          const above = n * BigInt(low) - target;
          const delta = below < 0n ? below : above > 0n ? above : 0n;
          return weight * delta ** 2n;
        },
      };
    });
    const costs = terms.map(term => term.cost);
    const lowerCosts = terms.map(term => term.lowerCost);
    const scoreGroups = () => groups.reduce((sum, group, i) => sum + costs[i](group.sum), 0n);

    if (runSearch && order.length <= maxSwapSize && groups.length > 1 && groups.length < order.length) {
      improveBySwaps(groups, costs);
    }
    const initial = scoreGroups();
    const canSearch = runSearch && initial > 0n && order.length <= maxSearchSize && groups.length < order.length;
    let result = { score: initial, optimal: initial === 0n || groups.length === order.length, states: 0 };
    if (canSearch) {
      result = groups.length === 2
        ? solveTwoGroups(groups, order, total, costs, initial)
        : search(groups, order, lowerCosts, initial);
    }
    const denominator = scale * n ** 3n;
    return {
      total,
      deviation: roundedRoot(result.score, denominator),
      variance: { numerator: result.score.toString(), denominator: denominator.toString() },
      optimal: result.optimal,
      states: result.states,
    };
  }

  return { optimize };
})();

if (typeof module !== "undefined") module.exports = Vyvazeni;
