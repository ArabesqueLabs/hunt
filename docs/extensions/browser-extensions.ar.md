# Browser extensions

Coming soon to your favourite browser! hunt extensions for Firefox, Chrome.

Th extension allows you to send job postings, selected notes, and links
directly to your _*hunt stash*_ to sort later.

The extensions are still in active development, and will be available in your
browser's extensions store soon.

## Building the extensions

In the meanwhile, you can get an early taste by building them and loading them
directly to your browser. Go to the extensions directory, and build them:

```sh
cd extension && make
```

The built extensions will be in `extensions/dist`, each in a directory named
after the browser is build for.

Follow your browser's documentation for loading the extension from a local
package (firefox[^1], chrome[^2], and safari[^3]).


[^1]: https://support.mozilla.org/en-US/kb/find-and-install-add-ons-add-features-to-firefox
[^2]: https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions#prereq-crx
[^3]: https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension
