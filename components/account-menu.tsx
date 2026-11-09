"use client";
import { AppearanceChoices } from "./workspace-appearance";
import { useLanguage } from "./language";

import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronDown,
  FileText,
  LogOut,
  ShieldCheck,
  UserRound,
} from "lucide-react";

export function AccountMenu({
  name,
  email,
  navigate,
  logout,
}: {
  name: string;
  email: string;
  navigate: (view: "profile" | "privacy" | "invoices") => void;
  logout: () => void;
}) {
  const { ui, localeTag } = useLanguage();

  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const keyboardFocus = useRef<"first" | "last" | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    if (keyboardFocus.current) {
      const items =
        root.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]');
      const item =
        keyboardFocus.current === "last"
          ? items?.[items.length - 1]
          : items?.[0];
      item?.focus();
      keyboardFocus.current = null;
    }
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      className="account-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        className="account-menu-trigger"
        aria-label={ui("Kontomenü für {0}", [name])}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          keyboardFocus.current = !open && event.detail === 0 ? "first" : null;
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (open) {
              const items =
                root.current?.querySelectorAll<HTMLElement>(
                  '[role="menuitem"], [role="menuitemradio"]',
                );
              (event.key === "ArrowUp"
                ? items?.[items.length - 1]
                : items?.[0]
              )?.focus();
            } else {
              keyboardFocus.current =
                event.key === "ArrowUp" ? "last" : "first";
              setOpen(true);
            }
          }
        }}
      >
        <span className="top-avatar" aria-hidden="true">
          {name[0]}
        </span>
        <span className="account-trigger-name">{name}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          className="account-dropdown"
          role="menu"
          aria-label={ui("Mein Konto")}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"], [role="menuitemradio"]',
              ),
            );
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length;
            items[next]?.focus();
          }}
        >
          <div className="account-menu-heading" role="presentation">
            <strong>{name}</strong>
            <span>{email}</span>
          </div>
          {(
            [
              ["profile", ui("Profil"), UserRound],
              ["privacy", ui("Datenschutz"), ShieldCheck],
              ["invoices", ui("Rechnungen"), FileText],
            ] as const
          ).map(([view, label, Icon]) => (
            <button
              key={view}
              role="menuitem"
              onClick={() => {
                close();
                navigate(view);
              }}
            >
              <Icon size={17} aria-hidden="true" />
              {label}
            </button>
          ))}
          <div className="account-menu-divider" role="separator" />
          <AppearanceChoices menu/>
          <div className="account-menu-divider" role="separator" />
          <button
            role="menuitem"
            onClick={() => {
              close();
              logout();
            }}
          >
            <LogOut size={17} aria-hidden="true" />
            {ui("Abmelden")}
          </button>
        </div>
      )}
    </div>
  );
}
