import { describe, expect, it } from "vitest";
import { Prism } from "prism-react-renderer";
import { registerShellPrismLanguage } from "../../../src/mainview/lib/prism-languages";

describe("registerShellPrismLanguage", () => {
  it("registers bash aliases for shell script highlighting", () => {
    const originalBash = Prism.languages.bash;
    const originalShell = Prism.languages.shell;
    const originalSh = Prism.languages.sh;

    delete Prism.languages.bash;
    delete Prism.languages.shell;
    delete Prism.languages.sh;

    try {
      registerShellPrismLanguage(Prism);

      expect(Prism.languages.bash).toBeDefined();
      expect(Prism.languages.shell).toBe(Prism.languages.bash);
      expect(Prism.languages.sh).toBe(Prism.languages.bash);
    } finally {
      if (originalBash) Prism.languages.bash = originalBash;
      if (originalShell) Prism.languages.shell = originalShell;
      if (originalSh) Prism.languages.sh = originalSh;
    }
  });
});
