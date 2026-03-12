import { isRef, dequal, logger, keysOf } from '@redocly/openapi-core';
import { exitWithError } from '../../../utils/error.js';
import { OPENAPI3_METHOD_NAMES } from '../../split/types.js';
import { addPrefix } from './add-prefix.js';
import { addSecurityPrefix } from './add-security-prefix.js';
import { formatTags } from './format-tags.js';
import { populateTags } from './populate-tags.js';
export function collectPaths({ joinedDef, withoutXTagGroups, openapi, context, serversAreTheSame, }) {
    const { apiFilename, apiTitle, api, potentialConflicts, tagsPrefix, componentsPrefix, oasVersion, } = context;
    const { paths, servers: rootServers } = openapi;
    const operationsSet = new Set(OPENAPI3_METHOD_NAMES);
    if (paths) {
        if (!joinedDef.hasOwnProperty('paths')) {
            joinedDef['paths'] = {};
        }
        for (const path of keysOf(paths)) {
            if (!joinedDef.paths.hasOwnProperty(path)) {
                joinedDef.paths[path] = {};
            }
            if (!potentialConflicts.paths.hasOwnProperty(path)) {
                potentialConflicts.paths[path] = {};
            }
            const pathItem = paths[path];
            const servers = serversAreTheSame ? pathItem.servers : pathItem.servers || rootServers || [];
            if (servers) {
                collectPathServers(servers, path);
            }
            for (const field of keysOf(pathItem)) {
                if (operationsSet.has(field)) {
                    collectPathOperation(pathItem, path, field);
                }
                if (field === 'parameters') {
                    collectPathParameters(pathItem, path);
                }
                if (typeof pathItem[field] === 'string') {
                    collectPathStringFields(pathItem, path, field);
                }
            }
        }
    }
    function collectPathStringFields(pathItem, path, field) {
        const fieldValue = pathItem[field];
        if (joinedDef.paths[path].hasOwnProperty(field) &&
            joinedDef.paths[path][field] !== fieldValue) {
            logger.warn(`warning: different ${field} values in ${path}\n`);
            return;
        }
        joinedDef.paths[path][field] = fieldValue;
    }
    function collectPathServers(servers, path) {
        if (!servers) {
            return;
        }
        if (!joinedDef.paths[path].hasOwnProperty('servers')) {
            joinedDef.paths[path].servers = [];
        }
        for (const server of servers) {
            let isFoundServer = false;
            for (const pathServer of joinedDef.paths[path].servers) {
                if (pathServer.url === server.url) {
                    if (!isServersEqual(pathServer, server)) {
                        exitWithError(`Different server values for (${server.url}) in ${path}.`);
                    }
                    isFoundServer = true;
                }
            }
            if (!isFoundServer) {
                joinedDef.paths[path].servers.push(server);
            }
        }
    }
    function collectPathParameters(pathItem, path) {
        if (!pathItem.parameters) {
            return;
        }
        if (!joinedDef.paths[path].hasOwnProperty('parameters')) {
            joinedDef.paths[path].parameters = [];
        }
        for (const parameter of pathItem.parameters) {
            let isFoundParameter = false;
            for (const pathParameter of joinedDef.paths[path].parameters) {
                // Compare $ref only if both are reference objects
                if (isRef(pathParameter) && isRef(parameter)) {
                    if (pathParameter['$ref'] === parameter['$ref']) {
                        isFoundParameter = true;
                    }
                }
                // Compare properties only if both are reference objects
                if (!isRef(pathParameter) && !isRef(parameter)) {
                    if (pathParameter.name === parameter.name && pathParameter.in === parameter.in) {
                        if (!dequal(pathParameter.schema, parameter.schema)) {
                            exitWithError(`Different parameter schemas for (${parameter.name}) in ${path}.`);
                        }
                        isFoundParameter = true;
                    }
                }
            }
            if (!isFoundParameter) {
                joinedDef.paths[path].parameters.push(parameter);
            }
        }
    }
    function collectPathOperation(pathItem, path, operation) {
        const pathOperation = pathItem[operation];
        if (!pathOperation) {
            return;
        }
        joinedDef.paths[path][operation] = pathOperation;
        potentialConflicts.paths[path][operation] = [
            ...(potentialConflicts.paths[path][operation] || []),
            api,
        ];
        const { operationId } = pathOperation;
        if (operationId) {
            if (!potentialConflicts.paths.hasOwnProperty('operationIds')) {
                potentialConflicts.paths['operationIds'] = {};
            }
            potentialConflicts.paths.operationIds[operationId] = [
                ...(potentialConflicts.paths.operationIds[operationId] || []),
                api,
            ];
        }
        const { tags, security } = joinedDef.paths[path][operation];
        if (tags) {
            joinedDef.paths[path][operation].tags = tags.map((tag) => addPrefix(tag, tagsPrefix));
            populateTags({
                joinedDef,
                withoutXTagGroups,
                context: {
                    api,
                    apiFilename,
                    apiTitle,
                    tags: formatTags(tags),
                    potentialConflicts,
                    tagsPrefix,
                    componentsPrefix,
                    oasVersion,
                },
            });
        }
        else {
            joinedDef.paths[path][operation]['tags'] = [addPrefix('other', tagsPrefix || apiFilename)];
            populateTags({
                joinedDef,
                withoutXTagGroups,
                context: {
                    api,
                    apiFilename,
                    apiTitle,
                    tags: formatTags(['other']),
                    potentialConflicts,
                    tagsPrefix: tagsPrefix || apiFilename,
                    componentsPrefix,
                    oasVersion,
                },
            });
        }
        if (!security && openapi.hasOwnProperty('security')) {
            joinedDef.paths[path][operation]['security'] = addSecurityPrefix(openapi.security, componentsPrefix);
        }
        else if (pathOperation.security) {
            joinedDef.paths[path][operation].security = addSecurityPrefix(pathOperation.security, componentsPrefix);
        }
    }
}
function isServersEqual(serverOne, serverTwo) {
    if (serverOne.description === serverTwo.description) {
        return dequal(serverOne.variables, serverTwo.variables);
    }
    return false;
}
//# sourceMappingURL=collect-paths.js.map