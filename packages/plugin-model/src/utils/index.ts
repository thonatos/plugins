import path from 'path';
import { EOL } from 'os';
import { readFileSync } from 'fs';
import { utils } from 'umi';

const { t, parser, traverse, winPath } = utils;
export type ModelItem = { absPath: string; namespace: string } | string;

export const getName = (absPath: string) => {
  const suffix = /(\.model)?\.(j|t)sx?$/;
  const result = absPath.match(/src\/(models|model|pages|page)\/(\S*)/);

  if (result) {
    return result[2]
      .replace(/(models|model)\//, '')
      .replace(/\//g, '.')
      .replace(suffix, '');
  }
  return path.basename(absPath).replace(suffix, '');
};

export const getPath = (absPath: string) => {
  const info = path.parse(absPath);
  return winPath(path.join(info.dir, info.name).replace(/'/, "'"));
};

export const genImports = (imports: string[]) =>
  imports
    .map(
      (ele, index) => `import model${index} from "${winPath(getPath(ele))}";`,
    )
    .join(EOL);

export const genExtraModels = (models: ModelItem[] = []) =>
  models.map(ele => {
    if (typeof ele === 'string') {
      return {
        importPath: getPath(ele),
        importName: getName(ele),
        namespace: getName(ele),
      };
    }
    return {
      importPath: getPath(ele.absPath),
      importName: getName(ele.absPath),
      namespace: ele.namespace,
    };
  });

type HookItem = { namespace: string; use: string[] };

export const sort = (ns: HookItem[]) => {
  let final: string[] = [];
  ns.forEach((item, index) => {
    if (item.use && item.use.length) {
      const itemGroup = [...item.use, item.namespace];

      const cannotUse = [item.namespace];
      for (let i = 0; i <= index; i += 1) {
        if (ns[i].use.filter(v => cannotUse.includes(v)).length) {
          if (!cannotUse.includes(ns[i].namespace)) {
            cannotUse.push(ns[i].namespace);
            i = -1;
          }
        }
      }

      const errorList = item.use.filter(v => cannotUse.includes(v));
      if (errorList.length) {
        throw Error(
          `Circular dependencies: ${item.namespace} can't use ${errorList.join(
            ', ',
          )}`,
        );
      }

      const intersection = final.filter(v => itemGroup.includes(v));
      if (intersection.length) {
        // first intersection
        const finalIndex = final.indexOf(intersection[0]);
        // replace with groupItem
        final = final
          .slice(0, finalIndex)
          .concat(itemGroup)
          .concat(final.slice(finalIndex + 1));
      } else {
        final.push(...itemGroup);
      }
    }
    if (!final.includes(item.namespace)) {
      // first occurance append to the end
      final.push(item.namespace);
    }
  });

  return [...new Set(final)];
};

export const genModels = (imports: string[]) => {
  const contents = imports.map(absPath => ({
    namespace: getName(absPath),
    content: readFileSync(absPath).toString(),
  }));
  const allUserModel = imports.map(getName);

  const checkDuplicates = (list: string[]) =>
    new Set(list).size !== list.length;

  const raw = contents.map((ele, index) => {
    const ast = parser.parse(ele.content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    const use: string[] = [];

    traverse.default(ast, {
      enter(astPath) {
        if (astPath.isIdentifier({ name: 'useModel' })) {
          try {
            // string literal
            const ns = (astPath.parentPath.node as any).arguments[0].value;
            if (allUserModel.includes(ns)) {
              use.push(ns);
            }
          } catch (e) {
            // console.log(e)
          }
        }
      },
    });

    return { namespace: ele.namespace, use, importName: `model${index}` };
  });

  const models = sort(raw);

  if (checkDuplicates(contents.map(ele => ele.namespace))) {
    throw Error('umi: models 中包含重复的 namespace！');
  }
  return raw.sort(
    (a, b) => models.indexOf(a.namespace) - models.indexOf(b.namespace),
  );
};

export const isValidHook = (filePath: string) => {
  const isTS = path.extname(filePath) === '.ts';
  const isTSX = path.extname(filePath) === '.tsx';
  const content = readFileSync(filePath, { encoding: 'utf-8' }).toString();

  const ast = parser.parse(content, {
    sourceType: 'module',
    plugins: [
      // .ts 不能加 jsx，因为里面可能有 `<Type>{}` 这种写法
      // .tsx, .js, .jsx 可以加
      isTS ? false : 'jsx',
      // 非 ts 不解析 typescript
      isTS || isTSX ? 'typescript' : false,
      // 支持更多语法
      'classProperties',
      'dynamicImport',
      'exportDefaultFrom',
      'exportNamespaceFrom',
      'functionBind',
      'nullishCoalescingOperator',
      'objectRestSpread',
      'optionalChaining',
      'decorators-legacy',
    ].filter(Boolean) as utils.parser.ParserPlugin[],
  });
  let valid = false;
  let identifierName = '';
  traverse.default(ast, {
    enter(p) {
      if (p.isExportDefaultDeclaration()) {
        const { type } = p.node.declaration;
        try {
          if (
            type === 'ArrowFunctionExpression' ||
            type === 'FunctionDeclaration'
          ) {
            valid = true;
          } else if (type === 'Identifier') {
            identifierName = (p.node.declaration as utils.t.Identifier).name;
          }
        } catch (e) {
          console.error(e);
        }
      }
    },
  });

  try {
    if (identifierName) {
      ast.program.body.forEach(ele => {
        if (ele.type === 'FunctionDeclaration') {
          if (ele.id?.name === identifierName) {
            valid = true;
          }
        }
        if (ele.type === 'VariableDeclaration') {
          if (
            (ele.declarations[0].id as utils.t.Identifier).name ===
              identifierName &&
            (ele.declarations[0].init as utils.t.ArrowFunctionExpression)
              .type === 'ArrowFunctionExpression'
          ) {
            valid = true;
          }
        }
      });
    }
  } catch (e) {
    valid = false;
  }

  return valid;
};

export const getValidFiles = (files: string[], modelsDir: string) =>
  files
    .map(file => {
      const filePath = path.join(modelsDir, file);
      const valid = isValidHook(filePath);
      if (valid) {
        return filePath;
      }
      return '';
    })
    .filter(ele => !!ele) as string[];
