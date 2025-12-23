import { useLayoutEffect } from "react";

export default function Page404() {
  useLayoutEffect(() => {
    document.title = "Not Found";
  });

  return (
    <div className="flex items-center justify-center">
      <h3>Not found</h3>
    </div>
  );
}
