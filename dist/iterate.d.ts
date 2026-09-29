/**
 * Pure array-iteration helpers shared by the CLI resolver and the browser
 * builder UI. Dependency-free so this module can be loaded directly in the
 * browser (via ui.html's <script type="module">) as well as bundled/run in
 * Node, keeping both surfaces on the exact same compiled logic.
 */
export declare function cartesian<T>(arrays: T[][]): T[][];
export declare function zip<T>(arrays: T[][]): T[][];
