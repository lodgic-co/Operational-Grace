import { type SpecVersion, type OASStatsAccumulator, type AsyncAPIStatsAccumulator } from '@redocly/openapi-core';
export declare function resolveStatsVisitorAndAccumulator(specVersion: SpecVersion): {
    statsVisitor: {
        ExternalDocs: {
            leave(): void;
        };
        ref: {
            enter(ref: import("@redocly/openapi-core").OasRef): void;
        };
        Tag: {
            leave(tag: import("@redocly/openapi-core").Oas3Tag | import("@redocly/openapi-core").Oas3_2Tag): void;
        };
        ChannelMap: {
            Channel: {
                leave(): void;
                Operation: {
                    leave(operation: any): void;
                };
                Parameter: {
                    leave(parameter: any): void;
                };
            };
        };
        NamedSchemas: {
            Schema: {
                leave(): void;
            };
        };
        Root: {
            leave(): void;
        };
    } | {
        ExternalDocs: {
            leave(): void;
        };
        ref: {
            enter(ref: import("@redocly/openapi-core").OasRef): void;
        };
        Tag: {
            leave(tag: import("@redocly/openapi-core").Oas3Tag | import("@redocly/openapi-core").Oas3_2Tag): void;
        };
        NamedChannels: {
            Channel: {
                leave(): void;
                Parameter: {
                    leave(parameter: any): void;
                };
            };
        };
        NamedOperations: {
            Operation: {
                leave(operation: any): void;
            };
        };
        NamedSchemas: {
            Schema: {
                leave(): void;
            };
        };
        Root: {
            leave(): void;
        };
    } | {
        ExternalDocs: {
            leave(): void;
        };
        ref: {
            enter(ref: import("@redocly/openapi-core").OasRef): void;
        };
        Tag: {
            leave(tag: import("@redocly/openapi-core").Oas3Tag | import("@redocly/openapi-core").Oas3_2Tag): void;
        };
        Link: {
            leave(link: any): void;
        };
        WebhooksMap: {
            Operation: {
                leave(operation: any): void;
            };
        };
        Paths: {
            PathItem: {
                leave(): void;
                Operation: {
                    leave(operation: any): void;
                };
                Parameter: {
                    leave(parameter: import("core/lib/typings/swagger.js").Oas2Parameter | import("@redocly/openapi-core").Oas3Parameter): void;
                };
            };
        };
        NamedSchemas: {
            Schema: {
                leave(): void;
            };
        };
        Root: {
            leave(): void;
        };
    };
    statsAccumulator: OASStatsAccumulator | AsyncAPIStatsAccumulator;
};
//# sourceMappingURL=visitor-and-accumulator-resolver.d.ts.map