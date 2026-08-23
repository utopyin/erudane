import type { SVGProps } from "react";

export type CircleStopOutline18Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function CircleStopOutline18({ strokeWidth = 1.5, ...props }: CircleStopOutline18Props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 18 18" {...props}>
      <circle
        cx="9"
        cy="9"
        r="7.25"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      ></circle>
      <rect
        x="6.25"
        y="6.25"
        width={5.5}
        height={5.5}
        rx="1"
        ry="1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        data-color="color-2"
      ></rect>
    </svg>
  );
}
