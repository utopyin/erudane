import type { SVGProps } from "react";

export type CircleCheckOutline18Props = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

export function CircleCheckOutline18({ strokeWidth = 1.5, ...props }: CircleCheckOutline18Props) {
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
      <polyline
        points="5.75 9.25 8 11.75 12.25 6.25"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        data-color="color-2"
      ></polyline>
    </svg>
  );
}
