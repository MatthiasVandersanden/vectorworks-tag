# Vectorwork tag action

This action looks at all previous tags, increments the latest tag, and tags the latest commit with the new tag.

## Inputs

### `token`

**Required** The secret github token that authorizes the tagging.

## Outputs

### `tag`

The value of the new tag.

## Example usage

```yaml
uses: actions/vectorworks-tag@v1.0
with:
  token: 'secret-token'
```