# Repository instructions

- Keep hardcoded source strings in English.
- Do not run the whole test suite (`npm test`) or other heavy commands in one go: it froze the machine once. Run only the test files related to the change (`node --experimental-transform-types --test tests/<file>.test.mjs`), one command at a time, and avoid running several heavy processes in parallel.
