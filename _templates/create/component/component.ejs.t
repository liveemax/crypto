---
to: src/components/<%= h.changeCase.pascal(name) %>/<%= h.changeCase.pascal(name) %>.tsx
---
import styles from "./styles.module.scss";

export function <%= h.changeCase.pascal(name) %>() {
  return <div className={styles.root}><%= h.changeCase.pascal(name) %></div>;
}
