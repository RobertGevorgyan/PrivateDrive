FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/privatedrive-api ./cmd/api

FROM alpine:3.22
RUN adduser -D -H privatedrive
USER privatedrive
COPY --from=build /out/privatedrive-api /usr/local/bin/privatedrive-api
EXPOSE 8080
ENTRYPOINT ["privatedrive-api"]
