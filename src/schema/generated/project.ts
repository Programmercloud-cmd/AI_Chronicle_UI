/** Generated from schema/v1. Do not edit manually. */

export interface ProjectRecord {
  schema_version: 1;
  project: {
    id: string;
    title: string;
    description?: string;
  };
  display: {
    timezone: string;
  };
}
