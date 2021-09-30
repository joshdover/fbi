# fbi

Tool for orchestrating Fleet Server and pre-configured Elastic Agents monitoring
real software (eg. nginx).

## Get Started

### Install pre-requisites
- Node.js 14+
- Docker
- Start Elasticsearch 8.0.0 snapshot with:
    ```sh
    bin/elasticsearch -E xpack.security.authc.api_key.enabled=true -E http.host=0.0.0.0
    ```
- Start Kibana 8.0.0 snapshot (or dev) with:
    ```sh
    bin/kibana --server.host=0.0.0.0
    ```

### Clone & configure
- Clone and bootstrap:
    ```sh
    git clone git@github.com:joshdover/fbi.git
    cd fbi
    npm run bootstrap
    ```
- Find your private IP address and update `kibana.host` and `elasticsearch.host` in `config/fbi.yml`
- Start the tool:
    ```sh
    npm start
    ```
