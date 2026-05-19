import { access } from "node:fs/promises";
import { extname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveWithExtension(path) {
  if (extname(path)) {
    return (await fileExists(path)) ? path : null;
  }

  for (const suffix of [".ts", ".tsx", ".js", ".mjs"]) {
    const candidate = `${path}${suffix}`;
    if (await fileExists(candidate)) return candidate;
  }

  for (const suffix of ["index.ts", "index.tsx", "index.js", "index.mjs"]) {
    const candidate = join(path, suffix);
    if (await fileExists(candidate)) return candidate;
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = await resolveWithExtension(join(projectRoot, "src", specifier.slice(2)));
    if (target) {
      return {
        url: pathToFileURL(target).href,
        shortCircuit: true,
      };
    }
  }

  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const parentPath =
      context.parentURL?.startsWith("file:") ? new URL(context.parentURL).pathname : projectRoot;
    const basePath = isAbsolute(specifier)
      ? specifier
      : resolvePath(parentPath, "..", specifier);
    const target = await resolveWithExtension(basePath);
    if (target) {
      return {
        url: pathToFileURL(target).href,
        shortCircuit: true,
      };
    }
  }

  return nextResolve(specifier, context);
}
