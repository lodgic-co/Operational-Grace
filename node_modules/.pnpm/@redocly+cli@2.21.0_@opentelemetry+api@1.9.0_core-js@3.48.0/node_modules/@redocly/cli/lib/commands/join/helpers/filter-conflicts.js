export function filterConflicts(entities) {
    return Object.entries(entities).filter(([_, files]) => files.length > 1);
}
//# sourceMappingURL=filter-conflicts.js.map