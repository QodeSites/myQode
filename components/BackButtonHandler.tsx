"use client";

import { useEffect } from "react";
import { App as CapApp } from "@capacitor/app";
import { useRouter } from "next/navigation";
import { PluginListenerHandle } from "@capacitor/core";

const BackButtonHandler = () => {
  const router = useRouter();

  useEffect(() => {
    let listenerHandle: PluginListenerHandle | null = null;

    CapApp.addListener("backButton", () => {
      const currentPath = window.location.pathname;
      const canGoBack = window.history.length > 1;

      console.log("Back button pressed on:", currentPath);

      if (currentPath === "/role_menu" || !canGoBack) {
        console.log("Exiting app...");
        CapApp.exitApp();
      } else {
        console.log("Going back...");
        router.back();
      }
    }).then((handle) => {
      listenerHandle = handle;
    });

    return () => {
      if (listenerHandle) {
        listenerHandle.remove();
      }
    };
  }, [router]);

  return null;
};

export default BackButtonHandler;
