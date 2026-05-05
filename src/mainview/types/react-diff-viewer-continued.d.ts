declare module "react-diff-viewer-continued" {
  import { type ComponentType } from "react";

  interface DiffViewerProps {
    oldValue: string;
    newValue: string;
    splitView?: boolean;
    leftTitle?: string;
    rightTitle?: string;
    styles?: Record<string, unknown>;
    hideLineNumbers?: boolean;
    showDiffOnly?: boolean;
    useDarkTheme?: boolean;
    compareMethod?: string;
  }

  export const DiffViewer: ComponentType<DiffViewerProps>;
  export default DiffViewer;

  export const DiffMethod: {
    [key: string]: string;
  };
}
