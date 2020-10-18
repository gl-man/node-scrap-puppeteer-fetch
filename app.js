var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
var mysql = require("mysql");

require("dotenv").config();

// First you need to create a connection to the database
// Be sure to replace 'user' and 'password' with the correct values
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

const promiseSQL = (sql) => {
  return new Promise((resolve, reject) => {
    connection.query(sql, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

const getAllTables = () =>
  promiseSQL(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = "${process.env.DB_NAME}"`
  ).then((res) => res.map((data) => data.table_name));

const getTableData = (table_name) => promiseSQL(`SELECT * FROM ${table_name}`);

const app = express();

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", function (req, res, next) {
  getAllTables()
    .then((data) => {
      res.render("tables", { dbs: data });
    })
    .catch((err) => {
      next(err);
    });
});

app.get("/:name", function (req, res, next) {
  getTableData(req.params.name)
    .then((data) => {
      let keys = [];
      if (data && data[0]) {
        keys = Object.keys(data[0]);
      }
      res.render("table_data", { data, keys });
    })
    .catch((err) => {
      next(err);
    });
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
