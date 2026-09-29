/**
 * Pure array-iteration helpers shared by the CLI resolver and the browser
 * builder UI. Dependency-free so this module can be loaded directly in the
 * browser (via ui.html's <script type="module">) as well as bundled/run in
 * Node, keeping both surfaces on the exact same compiled logic.
 */
export function cartesian(arrays) {
    if (arrays.length === 0)
        return [[]];
    const [first, ...rest] = arrays;
    const restCombos = cartesian(rest);
    const result = [];
    for (const val of first) {
        for (const combo of restCombos) {
            result.push([val, ...combo]);
        }
    }
    return result;
}
export function zip(arrays) {
    const maxLen = Math.max(...arrays.map(a => a.length), 1);
    const out = [];
    for (let i = 0; i < maxLen; i++) {
        out.push(arrays.map(a => a[i % a.length]));
    }
    return out;
}
//# sourceMappingURL=iterate.js.map