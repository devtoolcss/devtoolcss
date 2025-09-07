function getMaxSpecificity(rule) {
  const specificities = rule.rule.selectorList.selectors
    .filter((s, i) => rule.matchingSelectors.includes(i))
    .map((s) => s.specificity);
  // Find the maximum specificity as a tuple (lexicographically)
  return specificities.reduce(
    (max, spec) =>
      spec.a > max.a ||
      (spec.a === max.a && spec.b > max.b) ||
      (spec.a === max.a && spec.b === max.b && spec.c > max.c)
        ? spec
        : max,
    { a: -1, b: -1, c: -1 } // invalid
  );
}
/*
const specificity = getMaxSpecificity(rule);
const origin = rule.rule.origin;
console.log(origin, rule.rule.styleSheetId,rule.rule.style.range, specificity)
*/
