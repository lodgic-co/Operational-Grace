import { logger } from '@redocly/openapi-core';
import { red, yellow } from 'colorette';
export function duplicateTagDescriptionWarning(conflicts) {
    const tagsKeys = conflicts.map(([tagName]) => `\`${tagName}\``);
    const joinString = yellow(', ');
    logger.warn(`\nwarning: ${tagsKeys.length} conflict(s) on the ${red(tagsKeys.join(joinString))} tags description.\n`);
}
//# sourceMappingURL=duplicate-tag-description-warning.js.map