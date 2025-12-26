import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en/common.json";
import ru from "./locales/ru/common.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { common: en }, ru: { common: ru } },
    fallbackLng: "en",
    supportedLngs: ["en", "ru"],
    ns: ["common"],
    defaultNS: "common",
    detection: {
      order: ["querystring", "localStorage", "navigator"],
      lookupQuerystring: "lang",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

const applyHtmlLang = (lng: string) => {
  if (document?.documentElement) document.documentElement.lang = lng;
};
applyHtmlLang(i18n.language);
i18n.on("languageChanged", applyHtmlLang);

export default i18n;
