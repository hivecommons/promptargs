Value truncation now iterates lazily and stops after `max` code points instead of materialising the whole string via `Array.from`, restoring O(max) memory for large staged diffs (#395)
