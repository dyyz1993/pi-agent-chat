import { FileText, Wrench, Search, Code, Terminal, Image as ImageIcon } from "lucide-react";

const TOOLS = [
  { icon: FileText, label: "Read", color: "text-blue-400" },
  { icon: Wrench, label: "Edit", color: "text-green-400" },
  { icon: Search, label: "Search", color: "text-yellow-400" },
  { icon: Code, label: "Code", color: "text-purple-400" },
  { icon: Terminal, label: "Terminal", color: "text-cyan-400" },
  { icon: ImageIcon, label: "Image", color: "text-pink-400" },
];

export function ToolIconList() {
  return (
    <div className="flex flex-col items-center gap-0.5 w-full">
      {TOOLS.map(({ icon: Icon, label, color }) => (
        <button
          key={label}
          className={`w-7 h-7 rounded flex items-center justify-center transition-colors group ${color} hover:bg-gray-800/80`}
          title={label}
        >
          <Icon className="w-[15px] h-[15px]" />
        </button>
      ))}
    </div>
  );
}
