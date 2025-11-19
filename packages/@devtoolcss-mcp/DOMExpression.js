function splitExpression(expr) {
  if (expr[0] !== ".") throw new Error("Expression must start with a dot");
  const parts = [];
  let current = "";
  let inSingle = false,
    inDouble = false,
    bracketDepth = 0,
    parenDepth = 0;

  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    current += c;
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === "[") bracketDepth++;
      else if (c === "]") bracketDepth--;
      else if (c === "(") parenDepth++;
      else if (c === ")") parenDepth--;

      if (bracketDepth > 1 || parenDepth > 1) {
        throw new Error(
          "cannot evaluate complex expression with nested [] or ()",
        );
      } else if (bracketDepth < 0 || parenDepth < 0) {
        throw new Error("[] or () not balanced");
      }

      const nextChar = expr[i + 1];
      if (
        [".", "[", "("].includes(nextChar) &&
        bracketDepth === 0 &&
        parenDepth === 0
      ) {
        parts.push(current);
        current = "";
        continue;
      }
    }
  }
  if (current) parts.push(current);
  return parts;
}

function evalMethods(target, expr) {
  const operations = splitExpression(expr);

  for (const op of operations) {
    if (op.startsWith("(")) {
      // handle method calls e.g. querySelectorAll('div')
      const argStr = op.slice(1, -1).trim();
      const args = argStr
        ? argStr.split(",").map((arg) => {
            // probably cannot use JSON.parse because it is js expression
            // not really json with field quoted and only double quotes allowed
            arg = arg.trim();
            if (arg === "undefined") return undefined;
            if (arg === "null") return null;
            if (arg === "true") return true;
            if (arg === "false") return false;
            if (!isNaN(Number(arg))) return Number(arg);
            return arg.trim().replace(/^['"]|['"]$/g, "");
          })
        : [];
      target = target(...args);
    } else {
      // handle property access e.g. .parentNode, [0]
      const accessorStr = op.startsWith(".") ? op.slice(1) : op.slice(1, -1);
      const accessor = !isNaN(Number(accessorStr))
        ? Number(accessorStr)
        : accessorStr;
      const field = target[accessor];
      target = typeof field === "function" ? field.bind(target) : field;
    }
  }
  return target;
}

export async function evaluateDOMExpression(
  expression,
  inspector,
  nodeManager,
) {
  expression = expression.trim();
  const targetNodeName = expression.split(".")[0];
  const targetNode = nodeManager.getNode(targetNodeName, inspector);
  if (!targetNode) {
    throw new Error(`Target node '${targetNodeName}' not found`);
  }

  const remainingExpression = expression.slice(targetNodeName.length);
  // TODO: validate remainingExpression to ensure safety

  try {
    // cannot use dynamic code eval due to MV3
    const result = evalMethods(targetNode, remainingExpression);

    // Normalize result to array
    let nodes;
    if (result === null || result === undefined) {
      nodes = [];
    } else if (Array.isArray(result)) {
      nodes = result;
    } else {
      nodes = [result];
    }

    const uids = nodes.map((node) => nodeManager.setNode(node));
    return { uids };
  } catch (error) {
    throw new Error(`Failed to evaluate "${expression}": ${error.message}`);
  }
}
