interface PrismLike {
  languages: Record<string, unknown>;
}

export function registerShellPrismLanguage(prism: PrismLike) {
  if (prism.languages.bash) return;

  const bashGrammar = {
    shebang: {
      pattern: /^#!.*/,
      alias: "important",
    },
    comment: {
      pattern: /(^|[^\\])#.*/,
      lookbehind: true,
    },
    string: [
      {
        pattern: /"(?:\\[\s\S]|\$\([^)]+\)|`[^`]*`|[^"\\])*"/,
        greedy: true,
      },
      {
        pattern: /'(?:\\[\s\S]|[^'\\])*'/,
        greedy: true,
      },
    ],
    variable: /\$(?:\w+|[!#$?*@-]|\{[^}]+\})/,
    keyword:
      /\b(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|function|select|in|time|coproc)\b/,
    builtin:
      /\b(?:alias|bg|bind|break|builtin|cd|command|continue|declare|echo|enable|eval|exec|exit|export|fc|fg|getopts|hash|help|history|jobs|kill|let|local|logout|mapfile|popd|printf|pushd|pwd|read|readonly|return|set|shift|shopt|source|test|times|trap|type|typeset|ulimit|umask|unalias|unset|wait)\b/,
    function: /\b[a-zA-Z_][\w-]*(?=\s*\(\s*\))/,
    boolean: /\b(?:true|false)\b/,
    number: /\b\d+(?:\.\d+)?\b/,
    operator: /&&|\|\||;;|[<>]=?|[|&;()]/,
  };

  prism.languages.bash = bashGrammar;
  prism.languages.shell = bashGrammar;
  prism.languages.sh = bashGrammar;
}
