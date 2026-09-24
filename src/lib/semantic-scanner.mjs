import * as parser from '@babel/parser';

/**
 * Parses source code into Babel AST.
 *
 * @param {string} sourceCode
 * @returns {object}
 */
export function parseSource(sourceCode) {
  return parser.parse(sourceCode, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: false,
  });
}

/**
 * Extracts string literal values from an ArrayExpression AST node.
 *
 * @param {object} node
 * @returns {string[]}
 */
export function getArrayLiterals(node) {
  if (!node || node.type !== 'ArrayExpression') return [];
  const literals = [];
  for (const el of node.elements) {
    if (!el) continue;
    if (el.type === 'StringLiteral') {
      literals.push(el.value);
    }
  }
  return literals;
}

/**
 * Gate 1 & 2 helper for DAG task slice:
 * Detects if a CallExpression is .slice(1) on (e.extensions ?? [])
 * inside a conditional testing 'dag' === r.kind.
 *
 * @param {object} node
 * @param {object[]} ancestors
 * @returns {boolean}
 */
export function isDagSliceCall(node, ancestors = []) {
  if (!node || node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (!callee || callee.type !== 'MemberExpression' || callee.property?.name !== 'slice') {
    return false;
  }
  if (
    node.arguments.length !== 1 ||
    node.arguments[0]?.type !== 'NumericLiteral' ||
    node.arguments[0].value !== 1
  ) {
    return false;
  }

  const obj = callee.object;
  if (!obj || obj.type !== 'LogicalExpression' || obj.operator !== '??') {
    return false;
  }
  if (obj.left?.type !== 'MemberExpression' || obj.left?.property?.name !== 'extensions') {
    return false;
  }
  if (obj.right?.type !== 'ArrayExpression') {
    return false;
  }

  // Gate 2: Enclosing scope valid (inside function/closure)
  const hasFnScope = ancestors.some(
    (a) =>
      a.type === 'FunctionDeclaration' ||
      a.type === 'FunctionExpression' ||
      a.type === 'ArrowFunctionExpression'
  );
  if (!hasFnScope) return false;

  // Check enclosing conditional testing 'dag' === r.kind
  const cond = ancestors.slice().reverse().find((a) => a.type === 'ConditionalExpression');
  if (!cond) return false;

  let hasDagKind = false;
  function walkCond(n) {
    if (!n || typeof n !== 'object' || hasDagKind) return;
    if (n.type === 'BinaryExpression' && (n.operator === '===' || n.operator === '==')) {
      const leftDag = n.left.type === 'StringLiteral' && n.left.value === 'dag';
      const rightDag = n.right.type === 'StringLiteral' && n.right.value === 'dag';
      const leftKind = n.left.type === 'MemberExpression' && n.left.property?.name === 'kind';
      const rightKind = n.right.type === 'MemberExpression' && n.right.property?.name === 'kind';
      if ((leftDag && rightKind) || (rightDag && leftKind)) {
        hasDagKind = true;
        return;
      }
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'comments') continue;
      const child = n[k];
      if (Array.isArray(child)) {
        for (const item of child) walkCond(item);
      } else if (child && typeof child === 'object') {
        walkCond(child);
      }
    }
  }
  walkCond(cond.test);
  return hasDagKind;
}

/**
 * Gate 3: Consumer data flow validation.
 * Verifies that the array or target flows into child spawn args or launch descriptor return object with `args:`.
 *
 * @param {string} targetKind
 * @param {object} node
 * @param {object} parent
 * @param {object[]} ancestors
 * @param {object} rootAst
 * @returns {boolean}
 */
export function checkConsumerDataFlow(targetKind, node, parent, ancestors, rootAst) {
  if (targetKind === 'dagSlice') {
    return true;
  }

  // Direct usage in args property: { args: [...] }
  if (parent && (parent.type === 'ObjectProperty' || parent.type === 'Property')) {
    const keyName = parent.key?.name || parent.key?.value;
    if (keyName === 'args') return true;
  }

  // Direct argument to spawn/call: spawn(cmd, [...])
  if (parent && parent.type === 'CallExpression') {
    return true;
  }

  // Inside return statement
  if (parent && parent.type === 'ReturnStatement') {
    return true;
  }

  // If assigned to a variable, trace variable usage in enclosing scope
  let varName = null;
  if (parent && parent.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
    varName = parent.id.name;
  } else if (parent && parent.type === 'AssignmentExpression' && parent.left?.type === 'Identifier') {
    varName = parent.left.name;
  }

  if (varName) {
    const scopeNode =
      ancestors
        .slice()
        .reverse()
        .find(
          (a) =>
            a.type === 'FunctionDeclaration' ||
            a.type === 'FunctionExpression' ||
            a.type === 'ArrowFunctionExpression' ||
            a.type === 'Program'
        ) || rootAst;

    let flowsToConsumer = false;

    function searchUsage(n, p, anc) {
      if (!n || typeof n !== 'object' || flowsToConsumer) return;
      if (n.type === 'Identifier' && n.name === varName) {
        const isDecl =
          (p?.type === 'VariableDeclarator' && p.id === n) ||
          (p?.type === 'AssignmentExpression' && p.left === n);
        if (!isDecl) {
          // Check if used in ObjectProperty with key 'args'
          const inArgsProp = anc.some(
            (a) =>
              (a.type === 'ObjectProperty' || a.type === 'Property') &&
              (a.key?.name === 'args' || a.key?.value === 'args')
          );
          if (inArgsProp) {
            flowsToConsumer = true;
            return;
          }

          // Check if spread in array
          if (p?.type === 'SpreadElement') {
            flowsToConsumer = true;
            return;
          }

          // Check if passed to call
          if (p?.type === 'CallExpression') {
            flowsToConsumer = true;
            return;
          }

          // Check if returned
          if (p?.type === 'ReturnStatement') {
            flowsToConsumer = true;
            return;
          }
        }
      }

      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'comments') continue;
        const child = n[k];
        if (Array.isArray(child)) {
          for (const item of child) searchUsage(item, n, [...anc, n]);
        } else if (child && typeof child === 'object') {
          searchUsage(child, n, [...anc, n]);
        }
      }
    }

    searchUsage(scopeNode, null, []);
    return flowsToConsumer;
  }

  return false;
}

/**
 * Checks whether an ArrayExpression AST node already includes extension injection
 * (e.g. "--extension" string literal or a spread expression referencing flatMap/omox helper).
 *
 * @param {object} node
 * @param {string} [sourceCode]
 * @returns {boolean}
 */
export function checkArrayHasExtensionInjection(node, sourceCode = '') {
  if (!node) return false;

  if (sourceCode && typeof node.start === 'number' && typeof node.end === 'number') {
    const snippet = sourceCode.slice(node.start, node.end);
    if (snippet.includes('--extension') || snippet.includes('_omox')) {
      return true;
    }
  }

  if (node.type === 'ArrayExpression') {
    for (const el of node.elements) {
      if (!el) continue;
      if (el.type === 'StringLiteral' && el.value === '--extension') {
        return true;
      }
      if (el.type === 'SpreadElement') {
        const arg = el.argument;
        if (arg && arg.type === 'CallExpression') {
          const callee = arg.callee;
          if (callee && callee.type === 'MemberExpression' && callee.property?.name === 'flatMap') {
            return true;
          }
          if (callee && callee.type === 'Identifier' && callee.name.includes('_omox')) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Core semantic target locator enforcing all 4 validation gates:
 * - Gate 1: Literal signatures match
 * - Gate 2: Enclosing scope valid (inside function/closure or module root where permitted)
 * - Gate 3: Consumer data flow: array flows into child spawn args or launch descriptor return object with `args:`
 * - Gate 4: Uniqueness: exactly 1 match per target; 0 = null, >1 throws AMBIGUOUS_TARGET
 *
 * @param {string|object} sourceCodeOrAst
 * @returns {object}
 */
export function findSemanticTargets(sourceCodeOrAst) {
  const isAst = sourceCodeOrAst && typeof sourceCodeOrAst === 'object' && sourceCodeOrAst.type;
  const ast = isAst ? sourceCodeOrAst : parseSource(sourceCodeOrAst);
  const sourceCode = typeof sourceCodeOrAst === 'string' ? sourceCodeOrAst : '';

  const matches = {
    preflight: [],
    reflection: [],
    peopleAsk: [],
    fork: [],
    dagSlice: [],
  };

  function walk(node, parent, ancestors) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'ArrayExpression') {
      const literals = getArrayLiterals(node);

      // Gate 1: Literal signatures
      const hasPreflight =
        literals.includes('--list-models') &&
        literals.includes('--no-skills');

      const hasReflection =
        literals.includes('-p') &&
        literals.includes('--system-prompt') &&
        literals.includes('--tools') &&
        literals.includes('bash,edit') &&
        literals.includes('--model');

      const hasPeopleAsk =
        literals.includes('-p') &&
        literals.includes('--system-prompt') &&
        literals.includes('--tools') &&
        literals.includes('none') &&
        literals.includes('--model');

      const hasFork =
        literals.includes('-p') &&
        literals.includes('--fork') &&
        literals.includes('--session-dir') &&
        literals.includes('--model');

      if (hasPreflight) {
        // Gate 2: Preflight is valid at program level or inside function
        const validScope = ancestors.length > 0;
        // Gate 3: Data flow
        const validFlow = checkConsumerDataFlow('preflight', node, parent, ancestors, ast.program);
        if (validScope && validFlow) {
          matches.preflight.push({
            name: 'preflight',
            node,
            start: node.start,
            end: node.end,
            hasExtensionInjection: checkArrayHasExtensionInjection(node, sourceCode),
            hasNoExtensions: literals.includes('--no-extensions'),
          });
        }
      }

      if (hasReflection) {
        // Gate 2: Reflection must be inside a function/closure
        const validScope = ancestors.some(
          (a) =>
            a.type === 'FunctionDeclaration' ||
            a.type === 'FunctionExpression' ||
            a.type === 'ArrowFunctionExpression'
        );
        // Gate 3: Data flow
        const validFlow = checkConsumerDataFlow('reflection', node, parent, ancestors, ast.program);
        if (validScope && validFlow) {
          matches.reflection.push({
            name: 'reflection',
            node,
            start: node.start,
            end: node.end,
            hasExtensionInjection: checkArrayHasExtensionInjection(node, sourceCode),
            hasNoExtensions: literals.includes('--no-extensions'),
          });
        }
      }

      if (hasPeopleAsk) {
        // Gate 2: People ask must be inside a function/closure
        const validScope = ancestors.some(
          (a) =>
            a.type === 'FunctionDeclaration' ||
            a.type === 'FunctionExpression' ||
            a.type === 'ArrowFunctionExpression'
        );
        // Gate 3: Data flow
        const validFlow = checkConsumerDataFlow('peopleAsk', node, parent, ancestors, ast.program);
        if (validScope && validFlow) {
          matches.peopleAsk.push({
            name: 'peopleAsk',
            node,
            start: node.start,
            end: node.end,
            hasExtensionInjection: checkArrayHasExtensionInjection(node, sourceCode),
            hasNoExtensions: literals.includes('--no-extensions'),
          });
        }
      }

      if (hasFork) {
        // Gate 2: Fork must be inside a function/closure
        const validScope = ancestors.some(
          (a) =>
            a.type === 'FunctionDeclaration' ||
            a.type === 'FunctionExpression' ||
            a.type === 'ArrowFunctionExpression'
        );
        // Gate 3: Data flow
        const validFlow = checkConsumerDataFlow('fork', node, parent, ancestors, ast.program);
        if (validScope && validFlow) {
          matches.fork.push({
            name: 'fork',
            node,
            start: node.start,
            end: node.end,
            hasExtensionInjection: checkArrayHasExtensionInjection(node, sourceCode),
            hasNoExtensions: literals.includes('--no-extensions'),
          });
        }
      }
    }

    if (isDagSliceCall(node, ancestors)) {
      matches.dagSlice.push({
        name: 'dagSlice',
        node,
        start: node.start,
        end: node.end,
        hasSlice: true,
      });
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'comments') continue;
      const child = node[k];
      if (Array.isArray(child)) {
        for (const item of child) walk(item, node, [...ancestors, node]);
      } else if (child && typeof child === 'object') {
        walk(child, node, [...ancestors, node]);
      }
    }
  }

  walk(ast.program, null, []);

  // Gate 4: Uniqueness contract (0 is null; >1 throws AMBIGUOUS_TARGET)
  for (const [targetName, list] of Object.entries(matches)) {
    if (list.length > 1) {
      const err = new Error(
        `AMBIGUOUS_TARGET: Found ${list.length} matches for target '${targetName}'`
      );
      err.code = 'AMBIGUOUS_TARGET';
      err.target = targetName;
      err.matches = list;
      throw err;
    }
  }

  return {
    preflight: matches.preflight[0] || null,
    reflection: matches.reflection[0] || null,
    peopleAsk: matches.peopleAsk[0] || null,
    fork: matches.fork[0] || null,
    dagSlice: matches.dagSlice[0] || null,
    counts: {
      preflight: matches.preflight.length,
      reflection: matches.reflection.length,
      peopleAsk: matches.peopleAsk.length,
      fork: matches.fork.length,
      dagSlice: matches.dagSlice.length,
    },
  };
}

/**
 * Scans omo.js source code for its 4 semantic targets:
 * preflight, reflection, peopleAsk, fork.
 *
 * @param {string|object} sourceCodeOrAst
 * @returns {{ preflight: object|null, reflection: object|null, peopleAsk: object|null, fork: object|null, counts: object }}
 */
export function scanOmoJs(sourceCodeOrAst) {
  const result = findSemanticTargets(sourceCodeOrAst);
  return {
    preflight: result.preflight,
    reflection: result.reflection,
    peopleAsk: result.peopleAsk,
    fork: result.fork,
    counts: {
      preflight: result.counts.preflight,
      reflection: result.counts.reflection,
      peopleAsk: result.counts.peopleAsk,
      fork: result.counts.fork,
    },
  };
}

/**
 * Scans omo-task.js source code for the DAG task slice target.
 *
 * @param {string|object} sourceCodeOrAst
 * @returns {{ dagSlice: object|null, counts: object }}
 */
export function scanOmoTaskJs(sourceCodeOrAst) {
  const result = findSemanticTargets(sourceCodeOrAst);
  return {
    dagSlice: result.dagSlice,
    counts: {
      dagSlice: result.counts.dagSlice,
    },
  };
}

/**
 * Returns true if the DAG task .slice(1) pattern is present in source code.
 *
 * @param {string|object} sourceCodeOrAst
 * @returns {boolean}
 */
export function isDagSlicePresent(sourceCodeOrAst) {
  const result = scanOmoTaskJs(sourceCodeOrAst);
  return Boolean(result.dagSlice);
}
