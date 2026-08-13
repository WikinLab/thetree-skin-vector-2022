export const SUPPORTED_RESOURCE_LOADER_ORIGIN_CONTRACT_SCHEMAS = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
]);

export function assertResourceLoaderOriginContractSchema(schema) {
  if (!SUPPORTED_RESOURCE_LOADER_ORIGIN_CONTRACT_SCHEMAS.includes(schema)) {
    throw new Error(`Unsupported ResourceLoader origin contract schema: ${schema}`);
  }
  return schema;
}
