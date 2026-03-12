import { addComponentsPrefix } from './add-components-prefix.js';
import { addPrefix } from './add-prefix.js';
const Tags = 'tags';
const xTagGroups = 'x-tagGroups';
export function populateTags({ joinedDef, withoutXTagGroups, context, }) {
    const { api, apiFilename, apiTitle, tags, potentialConflicts, tagsPrefix, componentsPrefix, oasVersion, } = context;
    if (!joinedDef.hasOwnProperty(Tags)) {
        joinedDef[Tags] = [];
    }
    if (!potentialConflicts.tags.hasOwnProperty('all')) {
        potentialConflicts.tags['all'] = {};
    }
    if (withoutXTagGroups && !potentialConflicts.tags.hasOwnProperty('description')) {
        potentialConflicts.tags['description'] = {};
    }
    for (const tag of tags || []) {
        const entrypointTagName = addPrefix(tag.name, tagsPrefix);
        if (tag.description) {
            tag.description = addComponentsPrefix(tag.description, componentsPrefix);
        }
        const tagDuplicate = joinedDef.tags.find((t) => t.name === entrypointTagName);
        if (tagDuplicate && withoutXTagGroups) {
            // If tag already exist and `without-x-tag-groups` option,
            // check if description are different for potential conflicts warning.
            const isTagDescriptionNotEqual = tag.hasOwnProperty('description') && tagDuplicate.description !== tag.description;
            potentialConflicts.tags.description[entrypointTagName].push(...(isTagDescriptionNotEqual ? [api] : []));
        }
        else if (!tagDuplicate) {
            if (oasVersion === 'oas3_0' || oasVersion === 'oas3_1') {
                tag['x-displayName'] = tag['x-displayName'] || tag.name;
            }
            else if (oasVersion === 'oas3_2') {
                tag.summary = tag.summary || tag.name;
            }
            tag.name = entrypointTagName;
            joinedDef.tags.push(tag);
            if (withoutXTagGroups) {
                potentialConflicts.tags.description[entrypointTagName] = [api];
            }
        }
        if (!withoutXTagGroups && oasVersion !== 'oas3_2') {
            const groupName = apiTitle || apiFilename;
            createXTagGroups(joinedDef, groupName);
            if (!tagDuplicate) {
                populateXTagGroups(joinedDef, entrypointTagName, getIndexGroup(joinedDef, groupName));
            }
        }
        const doesEntrypointExist = !potentialConflicts.tags.all[entrypointTagName] ||
            (potentialConflicts.tags.all[entrypointTagName] &&
                !potentialConflicts.tags.all[entrypointTagName].includes(api));
        potentialConflicts.tags.all[entrypointTagName] = [
            ...(potentialConflicts.tags.all[entrypointTagName] || []),
            ...(!withoutXTagGroups && doesEntrypointExist ? [api] : []),
        ];
    }
}
function getIndexGroup(joinedDef, name) {
    return joinedDef[xTagGroups].findIndex((item) => item.name === name);
}
function createXTagGroups(joinedDef, name) {
    if (!joinedDef.hasOwnProperty(xTagGroups)) {
        joinedDef[xTagGroups] = [];
    }
    if (!joinedDef[xTagGroups].some((g) => g.name === name)) {
        joinedDef[xTagGroups].push({ name, tags: [] });
    }
    const indexGroup = getIndexGroup(joinedDef, name);
    if (!joinedDef[xTagGroups][indexGroup].hasOwnProperty(Tags)) {
        joinedDef[xTagGroups][indexGroup][Tags] = [];
    }
}
function populateXTagGroups(joinedDef, entrypointTagName, indexGroup) {
    if (!joinedDef[xTagGroups][indexGroup][Tags].find((t) => t.name === entrypointTagName)) {
        joinedDef[xTagGroups][indexGroup][Tags].push(entrypointTagName);
    }
}
//# sourceMappingURL=populate-tags.js.map