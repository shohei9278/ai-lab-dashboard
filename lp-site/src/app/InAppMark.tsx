"use client";

import { useEffect } from "react";
import { rememberedInApp, inAppOf } from "@/lp/inApp";

// 読み込んだあとにも、SNS のアプリの中のブラウザの印（<html data-inapp>）を付け直す（inApp.ts）
// 描く前に動かす文（IN_APP_SCRIPT）が付けた印が、iPhone の X の中では読み込み後に付いていなかった（運営者が /inapp-check で見つけた）。
// React が <html> を描き直すと、印が消えることがあるため。印が消されたら、また付ける
// data-inapp-src: どこで付いたか（script: 描く前の文・effect: ここで付け直した）。確かめ用ページに出す
export function InAppMark() {
  useEffect(() => {
    const html = document.documentElement;
    let kind = null as ReturnType<typeof inAppOf>;
    try {
      kind = rememberedInApp(sessionStorage.getItem("lab-inapp"));
    } catch {
      // 保存領域が使えないブラウザ
    }
    kind ??= inAppOf(navigator.userAgent, document.referrer, !!window.matchMedia?.("(pointer:coarse)").matches);
    if (!kind) return;
    const mark = kind;
    if (html.getAttribute("data-inapp") === mark && !html.hasAttribute("data-inapp-src")) html.setAttribute("data-inapp-src", "script");
    const apply = () => {
      if (html.getAttribute("data-inapp") === mark) return;
      html.setAttribute("data-inapp", mark);
      html.setAttribute("data-inapp-src", "effect");
    };
    apply();
    try {
      sessionStorage.setItem("lab-inapp", mark);
    } catch {
      // 保存領域が使えないブラウザ
    }
    const mo = new MutationObserver(apply);
    mo.observe(html, { attributes: true, attributeFilter: ["data-inapp"] });
    return () => mo.disconnect();
  }, []);
  return null;
}
