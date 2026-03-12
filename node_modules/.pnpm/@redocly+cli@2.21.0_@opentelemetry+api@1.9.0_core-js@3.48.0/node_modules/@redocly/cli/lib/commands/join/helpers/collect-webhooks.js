import { addPrefix } from './add-prefix.js';
import { formatTags } from './format-tags.js';
import { populateTags } from './populate-tags.js';
export function collectWebhooks({ joinedDef, withoutXTagGroups, openapi, context, }) {
    const { apiFilename, apiTitle, api, potentialConflicts, tagsPrefix, componentsPrefix, oasVersion, } = context;
    const webhooks = oasVersion === 'oas3_0' ? 'x-webhooks' : 'webhooks';
    const openapiWebhooks = openapi[webhooks];
    if (openapiWebhooks) {
        if (!joinedDef.hasOwnProperty(webhooks)) {
            joinedDef[webhooks] = {};
        }
        for (const webhook of Object.keys(openapiWebhooks)) {
            joinedDef[webhooks][webhook] = openapiWebhooks[webhook];
            if (!potentialConflicts.webhooks.hasOwnProperty(webhook)) {
                potentialConflicts.webhooks[webhook] = {};
            }
            for (const operation of Object.keys(openapiWebhooks[webhook])) {
                potentialConflicts.webhooks[webhook][operation] = [
                    ...(potentialConflicts.webhooks[webhook][operation] || []),
                    api,
                ];
            }
            for (const operationKey of Object.keys(joinedDef[webhooks][webhook])) {
                const { tags } = joinedDef[webhooks][webhook][operationKey];
                if (tags) {
                    joinedDef[webhooks][webhook][operationKey].tags = tags.map((tag) => addPrefix(tag, tagsPrefix));
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
            }
        }
    }
}
//# sourceMappingURL=collect-webhooks.js.map