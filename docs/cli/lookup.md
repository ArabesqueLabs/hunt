# hunt lookup

Read what a company's website or LinkedIn page says about it (its name, website, industry, size, headquarters and description), or what someone's LinkedIn profile says about them. It saves nothing, unless you ask.

## Examples

```sh
hunt lookup ashbyhq.com
hunt lookup linkedin.com/company/ashbyhq --save
```

## Good to know

- `--save` adds the company, or fills in what one you already have is missing.
- LinkedIn sometimes turns away pages without a sign-in. When it does, hunt says so: try the company's own site.

## Help

<!-- help: hunt lookup -->
```text
Read what a company's website or LinkedIn page says about it, or someone's LinkedIn profile (linkedin.com/in/…)

Usage: hunt lookup [OPTIONS] <URL>

Arguments:
  <URL>  The company's website, or its LinkedIn page

Options:
      --save       Add the company, or fill in what an existing one is missing
      --url <URL>  Where the service runs [env: HUNT_URL=] [default: http://127.0.0.1:4848]
  -h, --help       Print help
```
