import type { CSSProperties } from 'react';

/**
 * A placeholder shaped like the thing it is standing in for.
 *
 * The point is not that it looks busy — it is that the layout it produces is
 * the layout the real content will produce, so nothing moves when the data
 * arrives. A centred spinner on an empty page moves every row down by the
 * spinner's height the moment it goes away, which is the jump that makes an
 * application feel unfinished however fast it actually is.
 *
 * Always inside a container marked `aria-busy`, never announced itself.
 */
interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ width, height = 12, className, style }: SkeletonProps) {
  return (
    <div
      className={className === undefined ? 'skel' : `skel ${className}`}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}
