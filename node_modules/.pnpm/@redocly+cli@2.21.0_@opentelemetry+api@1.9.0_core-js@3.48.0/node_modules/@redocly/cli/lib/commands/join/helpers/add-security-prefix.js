export function addSecurityPrefix(security, componentsPrefix) {
    return componentsPrefix
        ? security?.map((s) => {
            const joinedSecuritySchema = {};
            for (const [key, value] of Object.entries(s)) {
                Object.assign(joinedSecuritySchema, { [componentsPrefix + '_' + key]: value });
            }
            return joinedSecuritySchema;
        })
        : security;
}
//# sourceMappingURL=add-security-prefix.js.map