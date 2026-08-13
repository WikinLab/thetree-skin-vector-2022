import fs from 'node:fs';
import path from 'node:path';

const SKIN_VARIABLES_IMPORT = 'mediawiki.skin.variables.less';

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function assertSkinVariantContract(variant, sourcePath) {
  if (
    variant?.schema !== 1
    || typeof variant.family !== 'string'
    || typeof variant.id !== 'string'
    || typeof variant.upstreamSkinName !== 'string'
    || typeof variant.upstream?.lessVariables !== 'string'
    || typeof variant.upstream?.elementsSource !== 'string'
    || typeof variant.upstream?.contentLinksSource !== 'string'
  ) {
    throw new Error(`Invalid skin variant contract: ${sourcePath}`);
  }
  return variant;
}

export function resolveResourceLoaderOriginContract(root, contract) {
  const variantPath = contract?.skinVariantContract;
  if (typeof variantPath !== 'string' || !variantPath) {
    throw new Error('ResourceLoader origin contract requires skinVariantContract.');
  }
  const skinVariant = assertSkinVariantContract(readJson(root, variantPath), variantPath);
  const declaredAlias = contract.shared?.importAliases?.[SKIN_VARIABLES_IMPORT];
  if (declaredAlias && declaredAlias !== skinVariant.upstream.lessVariables) {
    throw new Error(
      `ResourceLoader skin variable alias disagrees with ${variantPath}: `
      + `${declaredAlias} != ${skinVariant.upstream.lessVariables}`
    );
  }

  const authoritative = contract.customPropertyClosure?.authoritativeLessEntrypoints;
  if (
    authoritative != null
    && JSON.stringify(authoritative) !== JSON.stringify([skinVariant.upstream.lessVariables])
  ) {
    throw new Error(`ResourceLoader authoritative LESS entrypoints disagree with ${variantPath}.`);
  }

  return {
    ...contract,
    skinVariant,
    shared: {
      ...contract.shared,
      importAliases: {
        ...(contract.shared?.importAliases || {}),
        [SKIN_VARIABLES_IMPORT]: skinVariant.upstream.lessVariables
      }
    },
    customPropertyClosure: contract.customPropertyClosure
      ? {
          ...contract.customPropertyClosure,
          authoritativeLessEntrypoints: [skinVariant.upstream.lessVariables]
        }
      : null
  };
}
