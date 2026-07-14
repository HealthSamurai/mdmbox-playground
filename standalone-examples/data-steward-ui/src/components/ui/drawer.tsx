import React, { useCallback, useEffect, useRef, useState } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from "@health-samurai/react-components";

interface MdmDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  content: React.ReactNode;
  direction?: "left" | "right" | "top" | "bottom";
  children: React.ReactNode | React.ReactNode[];
  footer?: React.ReactNode
  canResize?:boolean
  defaultWidth?:number
  minWidth?:number
  onWidthChange?: (width: number) => void
}

export function MdmDrawer({ open, onOpenChange, title, content, direction = "right", children, footer, canResize = true, defaultWidth = 0.4, minWidth = 320, onWidthChange }: MdmDrawerProps) {
  const isHorizontal = direction === "right" || direction === "left";
  const resizable = canResize && isHorizontal;
  const [width, setWidth] = useState(() =>
    defaultWidth > 1 ? defaultWidth : 0
  );
  const dragging = useRef(false);
  const widthRef = useRef(width);
  const onWidthChangeRef = useRef(onWidthChange);
  onWidthChangeRef.current = onWidthChange;

  useEffect(() => {
    const w = defaultWidth > 1 ? defaultWidth : Math.round(window.innerWidth * defaultWidth);
    setWidth(w);
    widthRef.current = w;
  }, [defaultWidth]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.max(minWidth, Math.min(
        direction === "right" ? window.innerWidth - e.clientX : e.clientX,
        window.innerWidth - 100
      ));
      widthRef.current = newWidth;
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onWidthChangeRef.current?.(widthRef.current);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [direction, minWidth]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction={direction} handleOnly={true}>
      {children}
      <DrawerContent style={{
        maxHeight: '100vh',
        width: resizable ? `${width}px` : undefined,
        maxWidth: isHorizontal ? (resizable ? 'none' : '40vw') : undefined,
        userSelect: 'text',
      }}>
        {resizable && (
          <div
            onMouseDown={onMouseDown}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              [direction === "right" ? "left" : "right"]: 0,
              width: 6,
              cursor: 'col-resize',
              zIndex: 50,
            }}
          />
        )}
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <div className="absolute right-4 top-4 flex items-center gap-6">
            <div className="h-6 w-px bg-gray-300"></div>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none"
              aria-label="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.5"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </DrawerHeader>
        <div
          style={{
            overflowY: 'auto',
          }}>
          {content}
        </div>
        <DrawerFooter className="p-6">
          <div>
            {footer}
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}