import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";

import {
  linkProject,
  unlinkProject,
  getLinkedProjects,
  type LinkedProject,
} from "../../../src/shared/lib/linked-projects-config";

const TMP = join(process.cwd(), ".tmp-linked-projects-test");

describe("linked-projects", () => {
  beforeEach(async () => {
    await mkdir(TMP, { recursive: true });
  });

  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  describe("linkProject", () => {
    it("links a project successfully", async () => {
      const project: LinkedProject = {
        id: "test-dep",
        path: "/some/dep-project",
        description: "test dependency",
        relationship: "upstream",
        keyPaths: [],
        readonly: true,
      };

      const result = await linkProject(TMP, project);

      expect(result.ok).toBe(true);
      const saved = await getLinkedProjects(TMP);
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe("test-dep");
      expect(saved[0].path).toBe("/some/dep-project");
    });

    it("rejects linking a project with duplicate id", async () => {
      const project: LinkedProject = {
        id: "dup",
        path: "/first",
        description: "first",
        relationship: "sibling",
        keyPaths: [],
        readonly: false,
      };

      await linkProject(TMP, project);
      const result = await linkProject(TMP, { ...project, path: "/second" });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("already linked");

      const saved = await getLinkedProjects(TMP);
      expect(saved).toHaveLength(1);
      expect(saved[0].path).toBe("/first");
    });

    it("rejects linking a non-existent project path", async () => {
      const project: LinkedProject = {
        id: "ghost",
        path: "/non/existent/path",
        description: "ghost project",
        relationship: "upstream",
        keyPaths: [],
        readonly: true,
      };

      const result = await linkProject(TMP, { ...project, validatePath: true });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("does not exist");
    });
  });

  describe("unlinkProject", () => {
    it("unlinks a project by id", async () => {
      await linkProject(TMP, {
        id: "to-remove",
        path: "/some/path",
        description: "to remove",
        relationship: "downstream",
        keyPaths: [],
        readonly: true,
      });

      const result = await unlinkProject(TMP, "to-remove");

      expect(result.ok).toBe(true);
      const saved = await getLinkedProjects(TMP);
      expect(saved).toHaveLength(0);
    });

    it("returns error when unlinking non-existent id", async () => {
      const result = await unlinkProject(TMP, "nonexistent");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("getLinkedProjects", () => {
    it("returns empty array when config does not exist", async () => {
      const projects = await getLinkedProjects(TMP);

      expect(projects).toEqual([]);
    });

    it("returns all linked projects", async () => {
      await linkProject(TMP, {
        id: "a",
        path: "/a",
        description: "project A",
        relationship: "upstream",
        keyPaths: [{ path: "src/", description: "source" }],
        readonly: true,
      });
      await linkProject(TMP, {
        id: "b",
        path: "/b",
        description: "project B",
        relationship: "sibling",
        keyPaths: [],
        readonly: false,
      });

      const projects = await getLinkedProjects(TMP);

      expect(projects).toHaveLength(2);
      expect(projects.map((p) => p.id).sort()).toEqual(["a", "b"]);
    });
  });

  describe("persistence", () => {
    it("persists to .pi/linked-projects.json", async () => {
      await linkProject(TMP, {
        id: "persist-test",
        path: "/persist",
        description: "persist test",
        relationship: "upstream",
        keyPaths: [],
        readonly: true,
      });

      const configPath = join(TMP, ".pi", "linked-projects.json");
      expect(existsSync(configPath)).toBe(true);

      const raw = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.projects).toHaveLength(1);
      expect(parsed.projects[0].id).toBe("persist-test");
    });

    it("loads existing config from file", async () => {
      const configPath = join(TMP, ".pi");
      await mkdir(configPath, { recursive: true });
      await writeFile(
        join(configPath, "linked-projects.json"),
        JSON.stringify({
          projects: [
            {
              id: "pre-existing",
              path: "/pre",
              description: "pre-existing",
              relationship: "upstream",
              keyPaths: [],
              readonly: true,
            },
          ],
        }),
      );

      const projects = await getLinkedProjects(TMP);

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("pre-existing");
    });
  });
});
